"""Motor do app (fachada): liga as peças de app/engine/ e roda o laço principal.

Quem está de fora (editor, bandeja, ações, plugins, automações, valores) fala só com o Engine; ele repassa para a
peça certa. As peças:

    core.py        o que todas compartilham: o config em uso, a trava única (RLock) e o relógio
    session.py     a conexão com o Deck (abrir, cair, fechar, problema "desconectado")
    input.py       as teclas: apertar, soltar, segurar, toque duplo, repetir, combinações seguradas
    timers.py      o que espera o relógio: janela do toque duplo, aperto adiado, repetição
    navigation.py  páginas, histórico, página temporária e telas pintadas
    states.py      os estados liga/desliga (mic, obs.recording...)
    drawing.py     a fila de desenho (o que redesenhar) e o desenho (ícone, imagem, envio, GIFs, blocos)
    leds.py        o anel de LEDs (efeito, reações, cor temporária)
    recorder.py    gravar pela tecla do D6 (o editor arma uma combinação)

As peças não se avisam por eventos: o que acontece ao conectar, cair ou reler o config é a fachada que faz, na
ordem de sempre, e cada troca de página limpa o que sempre limpou (não é igual em todos os caminhos).

Threads (quem roda o quê):

- Laço do engine: run(). Na bandeja é a thread "engine" (app/tray.py); sem bandeja, a thread principal. Só ele fala
  com o D6: abrir e fechar o aparelho, ler as teclas, desenhar, animar os GIFs e mandar os quadros do anel. Também
  roda nele: as decisões das teclas (input, timers), o fim das respostas temporárias, a releitura do config (uma
  vez por segundo), o automations.tick() e a ligação dos plugins (plugins.attach/sync/stop_all).
- Pool de ações ("acao_0".."acao_3", 4 threads): actions.run de cada tecla, automação e teste do editor. Daqui vêm
  set_state, go_to_page, set_brightness, flash_light, paint_screens, show_temp_page, values.timer_* e
  action_failed (ação que deu erro). Na releitura do config, o obs.refresh também roda aqui.
- Editor: a thread "editor" (serve_forever) e uma thread por pedido (ThreadingHTTPServer). Lê page,
  device_connected, firmware, obs, device_info(), record_state() e obs_lists() (que conversa com o OBS na thread
  do pedido); chama go_to_page (/api/show), arm_record/cancel_record e press() (a ação vai para o pool).
  log_secrets e apply_log_settings() vêm da thread que cria o EditorServer (a principal).
- Plugins: OBS (thread "obs" e a thread de eventos do obsws), Discord ("discord-rpc") e os de terceiros
  ("plugin-<id>", lendo a saída do processo) chamam set_state, get_state e states_with_prefix, e mudam valores
  (values.set). As ações dos plugins rodam no pool.
- Automações: tick() no laço do engine; o que elas fazem vai para o pool (_submit). on_page() roda na thread de
  quem trocou a página (pool, editor); on_connected() no laço.
- Bandeja: a thread principal (menu "Sair") chama stop(); a thread "tray-status" lê device_connected, page e
  config (logging.notify).
- Valores (app/values.py): get() lê page, o brilho e os estados do engine de qualquer thread (desenho no laço,
  regras das ações no pool, /api/values do editor).

A trava única protege a troca de página (página, histórico, página temporária), a fila de desenho (teclas sujas,
brilho, marcas de erro), os estados e a passada de desenho (os ícones saem de um config e de uma página
coerentes). O que o laço lê sem a trava continua sem ela, como sempre foi.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from app import actions, automations, lighting, logs
from app.actions import Context
from app.config import Config, load_config
from app.engine.core import Clock, Shared
from app.engine.drawing import DrawQueue, Drawing
from app.engine.input import Input
from app.engine.leds import Leds, Rgb
from app.engine.navigation import Navigation
from app.engine.recorder import Recorder
from app.engine.session import Session
from app.engine.states import StateTable
from app.engine.timers import Timers
from d6.device import D6

if TYPE_CHECKING:
    from app.plugins import PluginManager
    from app.values import Values

log = logs.get("engine")
dlog = logs.get("device")  # USB: conectar, desconectar, desenhar
clog = logs.get("config")


class Engine:
    # Com tecla apertada, deixa redesenhar a que encolheu e as apertadas que não seguram combinação (o resto
    # espera soltar). Desligado = o comportamento antigo (nada redesenha com tecla apertada); só os testes trocam.
    redraw_while_held: bool = True

    def __init__(
        self,
        config_path: Path,
        debug: bool = False,
        plugins: PluginManager | None = None,
        values: Values | None = None,
        *,
        clock: Clock = time,
        device: Callable[[], D6] = D6,
    ) -> None:
        # plugins/values vêm do app/bootstrap.py; sem eles (código antigo, testes), as mesmas peças globais
        if plugins is None:
            from app.plugins import MANAGER

            plugins = MANAGER
        if values is None:
            from app.values import VALUES

            values = VALUES
        self.plugins = plugins
        self.config_path = config_path
        self.debug = debug  # --debug: tudo detalhado (quem filtra é o logs.py)
        if debug and not logs._force_debug:
            logs._force_debug = True  # Engine(debug=True) sem ter passado pelo logs.setup (testes)
        self.log_secrets: set[str] = set()  # o que esconder do log além das senhas do config (token do editor)
        # config em uso, trava e relógio, os mesmos para todas as peças. clock e device: os de verdade; os testes
        # passam um relógio falso e um D6 falso (as peças nunca leem o `time` nem criam o D6 direto)
        self._shared = Shared(load_config(config_path), clock)
        self._clock = clock
        self._lock = self._shared.lock
        # as peças recebem self._submit, nunca o pool: os testes trocam o _pool e o _stop_event depois
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="acao")
        self._stop_event = threading.Event()
        self._queue = DrawQueue(self._shared)
        self._timers = Timers(self._shared, self._submit)
        self._nav = Navigation(self._shared, self._queue, self._timers, self._submit)
        self._state_table = StateTable(self._shared, lambda: self._nav.page, self._queue)
        self._recorder = Recorder(clock)
        self._leds = Leds(self._shared, lambda: self._nav.page)
        self._state_table.register()
        self.values = values
        values.engine = self
        self._drawing = Drawing(self._shared, self._queue, self._nav, self._state_table, values)
        self.automations = automations.Automations(self)
        self.automations.configure(self.cfg.automations)
        self._input = Input(
            self._shared, self._nav, self._timers, self._leds, self._recorder, self._submit, mark=self._remark
        )
        self._session = Session(clock, device)  # "sem o Deck desde agora": o fim do __init__, como sempre foi
        self.apply_log_settings()

    # -- config ----------------------------------------------------------------

    @property
    def cfg(self) -> Config:
        return self._shared.cfg

    @cfg.setter
    def cfg(self, new: Config) -> None:
        self._shared.cfg = new

    @property
    def config(self) -> dict[str, Any]:
        return self.cfg.raw

    def apply_log_settings(self) -> None:
        """config.logging (detalhado, áreas) e as senhas a esconder; a cada leitura do config."""
        logs.configure(
            self.cfg.raw.get("logging"), secrets=[*self.plugins.secret_values(self.cfg.raw), *self.log_secrets]
        )

    def _reload_if_changed(self) -> None:
        if not self.cfg.changed_on_disk():
            return
        try:
            new = load_config(self.config_path)
        except Exception as e:
            # ConfigError já diz tudo; outra exceção é inesperada e vai com o traceback
            clog.warning(
                "Config reload failed, keeping the previous version: %s",
                e,
                exc_info=not isinstance(e, ValueError),
                extra={"ctx": {"file": str(self.config_path)}},
            )
            self.cfg.mark_seen()
            return
        with self._lock:
            self.cfg = new
            self._nav.on_reload(new)  # a página sumiu: volta para a inicial
            self._state_table.register()
            self._queue.mark_all()
            self._leds.configure(new.lighting)
            self.automations.configure(new.automations)
            self._queue.forget_dynamic()
            self._drawing.forget_slices()
            self._queue.reload_brightness(new.brightness)
        self.apply_log_settings()
        clog.info(
            "Config reloaded: %d pages, %d keys (page %s)",
            len(new.pages),
            sum(len(k) for k in new.pages.values()),
            self.page,
        )
        try:
            from app import history

            history.record(self.config_path)  # pega edições feitas direto no arquivo (o editor já registra as dele)
        except Exception as e:
            logs.get("history").warning("Couldn't save the version in the history: %s", e, exc_info=True)
        self._session.apply_options(self.cfg)
        self._sync_plugins()
        if self.obs is not None and self.obs.req is not None:
            self._pool.submit(self.obs.refresh)

    def _sync_plugins(self) -> None:
        """Liga, atualiza ou desliga cada plugin (OBS, Discord, terceiros) conforme o config."""
        self.plugins.attach(self)
        self.plugins.sync(self.cfg.raw)

    @property
    def obs(self) -> Any:
        """Conexão com o OBS (do plugin embutido), ou None se ele estiver desligado."""
        inst = self.plugins.instance("obs")
        return getattr(inst, "client", None)

    # -- o que outras partes do app leem direto ---------------------------------

    @property
    def _states(self) -> dict[str, bool]:
        """Os estados (o app/values.py procura aqui um valor que não achou nos outros lugares)."""
        return self._state_table.flags

    @property
    def _brightness(self) -> int:
        """Brilho atual (o app/values.py lê daqui o valor do brilho que as teclas mostram)."""
        return self._queue.brightness

    @property
    def light(self) -> lighting.Lighting:
        return self._leds.light

    # -- API usada pelas ações ---------------------------------------------------

    def get_state(self, name: str) -> bool:
        return self._state_table.get(name)

    def set_state(self, name: str, value: bool) -> None:
        self._state_table.set(name, value)

    def states_with_prefix(self, prefix: str) -> list[str]:
        return self._state_table.with_prefix(prefix)

    def go_to_page(self, name: str) -> None:
        target = self._nav.go_to_page(name)
        if target is not None:
            self.automations.on_page(target)

    def set_brightness(self, value: int, relative: bool = False) -> None:
        with self._lock:
            self._queue.set_brightness(value, relative)

    def paint_screens(self, icon: dict[str, Any], seconds: float, dismiss: bool, passthrough: bool) -> None:
        self._nav.paint_screens(icon, seconds, dismiss, passthrough)

    def show_temp_page(
        self, page: str, seconds: float, dismiss: bool, passthrough: bool, show_left: bool, light: object
    ) -> None:
        self._nav.show_temp_page(page, seconds, dismiss, passthrough, show_left)
        if light:
            self.flash_light(str(light), seconds, False)

    def flash_light(self, color: str, seconds: float, blink: bool) -> None:
        self._leds.flash(color, seconds, blink)

    def action_failed(self, key: int, page: str | None = None) -> None:
        """Uma ação da tecla deu erro: ela mostra a marca de erro por 1 s (config logging.key_error)."""
        self._drawing.action_failed(key, page)

    # -- ações das teclas ---------------------------------------------------------

    def _ctx(self, key: int, moment: str = "press", label: str | None = None) -> Context:
        if label is None and key:
            sp = self.cfg.spec_at(self.page, key)[0]
            text = (sp.icon or {}).get("text") if sp is not None else None
            label = str(text) if text else None
        return Context(self, self.page, key, moment, label)

    def _remark(self, key: int) -> None:
        """A tecla encolheu ou voltou: redesenha (e o GIF dela recomeça do primeiro quadro)."""
        with self._lock:
            self._queue.mark(key)
        self._drawing.restart_animation(key)

    def _submit(self, spec: object, key: int, moment: str = "press", label: str | None = None) -> None:
        """Manda a ação para o pool (a página do Context é a da tela na hora de mandar)."""
        if spec is not None:
            self._pool.submit(actions.run, spec, self._ctx(key, moment, label))

    # -- API usada pelo editor -------------------------------------------------------

    @property
    def page(self) -> str:
        return self._nav.page

    @property
    def deck(self) -> D6 | None:
        """O Deck aberto (None = desconectado)."""
        return self._session.deck

    @property
    def firmware(self) -> str | None:
        return self._session.firmware

    @property
    def device_connected(self) -> bool:
        return self.deck is not None

    def device_info(self) -> dict[str, Any]:
        """Dados do aparelho para o pacote de diagnóstico."""
        return self._session.info()

    def leds_now(self) -> list[Rgb] | None:
        """Último quadro mandado ao anel (para a prévia do editor)."""
        return self._leds.now()

    def press(self, page: str, key: int, which: str = "action") -> None:
        """Roda a ação de uma tecla como se ela tivesse sido apertada (botão "testar")."""
        spec = self.cfg.page_keys(page).get(key)
        if spec is None:
            raise ValueError(f"tecla {page}:{key} não configurada")
        action = {"action": spec.action, "hold": spec.hold, "release": spec.release}[which]
        if action is not None:
            text = (spec.icon or {}).get("text")
            log.info("Testing key %d (page %s, %s) from the editor", key, page, which)
            self._pool.submit(actions.run, action, Context(self, page, key, "test", str(text) if text else None))

    def arm_record(self, combo: str, seconds: float = 30) -> None:
        self._recorder.arm(combo, seconds)

    def cancel_record(self) -> None:
        self._recorder.cancel()

    def record_state(self) -> dict[str, Any]:
        return self._recorder.state()

    def obs_lists(self) -> dict[str, Any]:
        """Cenas e entradas do OBS (para os menus do editor)."""
        out: dict[str, Any] = {"connected": False, "scenes": [], "inputs": [], "sources": {}}
        obs = self.obs
        if obs is None or obs.req is None:
            return out
        try:
            scenes = [s["sceneName"] for s in reversed(obs.call("GetSceneList").get("scenes", []))]
            inputs = [i["inputName"] for i in obs.call("GetInputList").get("inputs", [])]
            sources = {}
            for sc in scenes:
                items = obs.call("GetSceneItemList", {"sceneName": sc}).get("sceneItems", [])
                sources[sc] = [it["sourceName"] for it in items]
            out.update(connected=True, scenes=scenes, inputs=inputs, sources=sources)
        except Exception as e:
            logs.get("plugins.obs").debug("Couldn't read the scene list for the editor", exc_info=True)
            out["error"] = str(e)
        return out

    def stop(self) -> None:
        self._stop_event.set()

    # -- conectar e cair ---------------------------------------------------------------

    def _open_deck(self) -> bool:
        """Tenta abrir o D6. Devolve False se não estiver disponível."""
        deck = self._session.open()
        if deck is None:
            return False
        self._leds.forget()
        self._session.apply_options(self.cfg)
        deck.enable_keys(self._queue.brightness)
        with self._lock:
            self._drawing.forget_screens()  # o D6 pode ter perdido as imagens
            self._input.forget_pressed()
        self._session.read_firmware()
        self._queue.clear_errors()
        self._session.connected()
        self.automations.on_connected()
        return True

    def _close_deck(self) -> None:
        self._input.release_mirrored()  # não deixa Ctrl/Shift presos
        self._drawing.stop_animations()
        self._session.close()

    # -- loop principal -------------------------------------------------------------

    def _check_answers(self) -> None:
        """Respostas temporárias (telas pintadas, página temporária, cor no anel, marca de erro) que acabaram."""
        now = self._clock.monotonic()
        self._nav.expire(now)
        self._leds.expire_flash(now)
        self._queue.expire_errors(now)

    def _tick(self) -> None:
        """Uma volta do laço: lê as teclas (esperando no máximo até a próxima coisa com hora marcada), roda o que
        venceu e manda ao Deck o que mudou."""
        deck = self.deck
        assert deck is not None  # o run() só chama com o Deck aberto
        timeout = 30
        due = self._drawing.next_frame_due()
        if due is not None:
            wait = due - self._clock.monotonic()
            timeout = max(1, min(30, int(wait * 1000)))
        if self._leds.animating():
            timeout = min(timeout, 15)
        if self._timers.busy:
            timeout = min(timeout, 10)
        for ev in deck.events(timeout_ms=timeout):
            self._input.on_key(ev.key, ev.pressed)
        self._input.check_holds()
        self._timers.run(self._input.pressed)
        self._check_answers()
        self._drawing.refresh_dynamic()
        self.automations.tick()
        now = self._clock.monotonic()
        self._input.expire_sunk(now)
        sunk = set(self._input.sunk)
        if not self._input.holding(now):
            self._drawing.flush(deck, sunk)
        elif self.redraw_while_held:
            # com tecla apertada, só redesenham a que acabou de encolher e as apertadas que não seguram
            # combinação: as outras esperam soltar, para o envio não atrasar o 'soltar' de quem segura
            allowed = self._input.drawable_while_held(now)
            self._drawing.flush(deck, sunk, only=allowed)
            self._input.drawn(allowed)
        # (redraw_while_held desligado: não redesenha nada com tecla apertada, como antes)
        self._drawing.advance_animations(deck, skip=sunk)
        self._leds.update(deck)

    def run(self) -> None:
        """Loop principal. Termina com stop() ou Ctrl+C. Reconecta se o D6 sumir."""
        self._stop_event.clear()
        self._sync_plugins()
        log.info("Running with %s (page %s)", self.config_path.name, self.page)
        last_reload_check = 0.0
        try:
            while not self._stop_event.is_set():
                now = self._clock.monotonic()
                if now - last_reload_check > 1.0:
                    last_reload_check = now
                    self._reload_if_changed()
                if self.deck is None:
                    if not self._open_deck():
                        self._session.check_disconnected()
                        self._stop_event.wait(2)
                    continue
                try:
                    self._tick()
                except (OSError, ValueError, IOError) as e:
                    # erro de HID = D6 desconectado, PC voltando da suspensão etc.
                    dlog.warning("Deck connection lost (%s); reconnecting", e)
                    self._close_deck()
        finally:
            self.plugins.stop_all()
            self._pool.shutdown(wait=False, cancel_futures=True)
            self._close_deck()
            logs.resolve("device.disconnected")
            log.info("Stopped")
