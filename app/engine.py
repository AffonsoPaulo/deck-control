"""Motor do app: lê as teclas, roda as ações, cuida de páginas, estados e ícones.

Toda a comunicação com o D6 acontece numa única thread (loop em run()).
As ações rodam num pool de threads, para uma ação lenta (delay, http) não
travar as teclas. Mudanças de estado/página só marcam teclas como "sujas";
o loop principal redesenha apenas as que mudaram de fato.
"""
from __future__ import annotations

import hashlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app import actions, automations, icons, keys, lighting, logs, values, winutil
from app.i18n import tr
from app.actions import Context
from app.config import Config, load_config
from d6 import render
from d6.device import KEY_COUNT, D6

log = logs.get("engine")
klog = logs.get("keys")          # aperto/soltura e a decisão (toque, duplo, segurar, repetir)
dlog = logs.get("device")        # USB: conectar, desconectar, desenhar
clog = logs.get("config")
vlog = logs.get("values")

DISCONNECTED_PROBLEM = 5.0       # s sem o Deck até virar um problema em aberto
ERROR_MARK_S = 1.0               # quanto tempo a tecla mostra a marca de erro


class Engine:
    def __init__(self, config_path: Path, debug: bool = False):
        self.config_path = config_path
        self.debug = debug               # --debug: tudo detalhado (quem filtra é o logs.py)
        if debug and not logs._force_debug:
            logs._force_debug = True     # Engine(debug=True) sem ter passado pelo logs.setup (testes)
        self.log_secrets: set[str] = set()   # o que esconder do log além das senhas do config (token do editor)
        self.cfg: Config = load_config(config_path)
        self.deck: D6 | None = None

        self._lock = threading.RLock()
        self._states: dict[str, bool] = {}
        self._dirty: set[int] = set(range(1, KEY_COUNT + 1))
        self._sent: dict[int, str] = {}           # hash do JPEG atualmente em cada tecla
        self._page = self.cfg.home
        self._history: list[str] = []
        self._brightness = self.cfg.brightness
        self._brightness_dirty = False
        self._pressed: dict[int, float] = {}      # tecla -> momento em que foi apertada
        self._hold_fired: set[int] = set()
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="acao")
        self._stop_event = threading.Event()
        self._waiting_deck = False
        self._mirrored: dict[int, str] = {}       # tecla -> combinação segurada (ação 'bind')
        self._taps: dict[int, dict] = {}          # toque simples esperando ver se vem o 2º (toque duplo)
        self._doubled: set[int] = set()           # teclas cujo 2º toque já rodou o 'double'
        self._repeat: dict[int, dict] = {}        # tecla -> {action, next, every, since} (repetir enquanto segura)
        self._deferred: dict[int, dict] = {}      # aperto adiado: página com toque duplo espera igual em todas
        self._record: dict | None = None          # "enviar pelo Deck": {combo, until}
        self._recorded: set[int] = set()          # teclas usadas para gravar (o soltar não roda nada)
        self._record_sent: dict | None = None     # último envio: {combo, key, at}
        self._anims: dict[int, dict] = {}         # tecla -> GIF tocando (quadros, durações, posição)
        self._frame_cache: dict[str, tuple[list[bytes], list[float]]] = {}
        self.firmware: str | None = None
        self.light = lighting.Lighting()
        self.light.configure(self.cfg.lighting)
        self._led_sent: list | None = None        # último quadro mandado ao anel de LEDs
        self._led_at = 0.0                        # quando foi mandado
        self._screen_off = False
        self._screen_checked = 0.0
        self._register_states()
        from app.values import VALUES
        self.values = VALUES
        VALUES.engine = self
        self.automations = automations.Automations(self)
        self.automations.configure(self.cfg.automations)
        self._overlay: dict | None = None         # telas pintadas (resposta temporária)
        self._temp: dict | None = None            # página temporária
        self._flash: dict | None = None           # cor no anel (resposta temporária)
        self._swallow: set[int] = set()           # teclas que só fecharam uma resposta (o soltar não roda nada)
        self._dyn: dict[int, str] = {}            # tecla que mostra valores -> último ícone resolvido
        self._dyn_at = 0.0
        self._slices: dict = {}                   # bloco "imagem contínua": imagem grande já cortada
        self._key_errors: dict[int, dict] = {}    # tecla -> marca de erro {at, until} (until None: ainda não desenhou)
        self._lost_at: float | None = time.monotonic()   # desde quando está sem o Deck (None = conectado)
        self.apply_log_settings()

    # -- config ----------------------------------------------------------------

    @property
    def config(self) -> dict:
        return self.cfg.raw

    def apply_log_settings(self) -> None:
        """config.logging (detalhado, áreas) e as senhas a esconder; a cada leitura do config."""
        from app.plugins import MANAGER
        logs.configure(self.cfg.raw.get("logging"), secrets=[*MANAGER.secret_values(self.cfg.raw), *self.log_secrets])

    def _register_states(self) -> None:
        with self._lock:
            for name in self.cfg.all_states():
                self._states.setdefault(name, False)

    def _reload_if_changed(self) -> None:
        if not self.cfg.changed_on_disk():
            return
        try:
            new = load_config(self.config_path)
        except Exception as e:
            # ConfigError já diz tudo; outra exceção é inesperada e vai com o traceback
            clog.warning("Config reload failed, keeping the previous version: %s", e,
                         exc_info=not isinstance(e, ValueError), extra={"ctx": {"file": str(self.config_path)}})
            self.cfg.mark_seen()
            return
        with self._lock:
            self.cfg = new
            if self._page not in new.pages:
                self._page, self._history = new.home, []
            self._register_states()
            self._dirty = set(range(1, KEY_COUNT + 1))
            self.light.configure(new.lighting)
            self._led_sent = None
            self.automations.configure(new.automations)
            self._dyn.clear()
            self._slices.clear()
            if new.brightness != self._brightness:
                self._brightness, self._brightness_dirty = new.brightness, True
        self.apply_log_settings()
        clog.info("Config reloaded: %d pages, %d keys (page %s)", len(new.pages),
                  sum(len(k) for k in new.pages.values()), self._page)
        try:
            from app import history
            history.record(self.config_path)   # pega edições feitas direto no arquivo (o editor já registra as dele)
        except Exception as e:
            logs.get("history").warning("Couldn't save the version in the history: %s", e, exc_info=True)
        self._apply_device_options()
        self._sync_plugins()
        if self.obs is not None and self.obs.req is not None:
            self._pool.submit(self.obs.refresh)

    def _apply_device_options(self) -> None:
        if self.deck is not None:
            self.deck.settle = float((self.cfg.raw.get("device") or {}).get("settle", 1.0))

    def _sync_plugins(self) -> None:
        """Liga, atualiza ou desliga cada plugin (OBS, Discord, terceiros) conforme o config."""
        from app.plugins import MANAGER
        MANAGER.attach(self)
        MANAGER.sync(self.cfg.raw)

    @property
    def obs(self):
        """Conexão com o OBS (do plugin embutido), ou None se ele estiver desligado."""
        from app.plugins import MANAGER
        inst = MANAGER.instance("obs")
        return getattr(inst, "client", None)

    # -- API usada pelas ações ---------------------------------------------------

    def get_state(self, name: str) -> bool:
        with self._lock:
            return self._states.get(name, False)

    def set_state(self, name: str, value: bool) -> None:
        with self._lock:
            old = self._states.get(name)
            if old == value:
                return
            self._states[name] = value
            for key, spec in self.cfg.page_keys(self._page).items():
                if spec.state == name:
                    self._dirty.add(key)
            for key in range(1, KEY_COUNT + 1):          # teclas com regras/valores podem depender do estado
                sp = self.cfg.spec_at(self._page, key)[0]
                if sp is not None and sp.dynamic:
                    self._dirty.add(key)
        vlog.debug("State %s: %s -> %s", name, old, value)

    def states_with_prefix(self, prefix: str) -> list[str]:
        with self._lock:
            return [n for n in self._states if n.startswith(prefix)]

    def go_to_page(self, name: str) -> None:
        with self._lock:
            before = self._page
            if name == "back":
                if not self._history:
                    return
                target = self._history.pop()
            elif name == "home":
                target, self._history = self.cfg.home, []
            else:
                if name not in self.cfg.pages:
                    raise ValueError(f"página '{name}' não existe")
                if name == self._page:
                    return
                self._history.append(self._page)
                target = name
            self._page = target
            self._dirty = set(range(1, KEY_COUNT + 1))
            self._repeat.clear()                  # repetição é da tecla da página anterior
            self._key_errors.clear()              # a marca de erro era de uma tecla da outra página
        log.info("Page changed: %s -> %s", before, target)
        if self._temp is not None and target != self._temp["page"]:
            self._temp = None                             # saiu da página temporária na mão
        self._dyn.clear()
        self.automations.on_page(target)

    def set_brightness(self, value: int, relative: bool = False) -> None:
        with self._lock:
            if relative:
                value = self._brightness + value
                if value > 100:
                    value = 10
                elif value < 10:
                    value = 100
            self._brightness = max(0, min(100, value))
            self._brightness_dirty = True

    # -- teclas -------------------------------------------------------------------

    def _ctx(self, key: int, moment: str = "press", label: str | None = None) -> Context:
        if label is None and key:
            sp = self.cfg.spec_at(self._page, key)[0]
            text = (sp.icon or {}).get("text") if sp is not None else None
            label = str(text) if text else None
        return Context(self, self._page, key, moment, label)

    def _submit(self, spec, key: int, moment: str = "press", label: str | None = None) -> None:
        if spec is not None:
            self._pool.submit(actions.run, spec, self._ctx(key, moment, label))

    def action_failed(self, key: int, page: str | None = None) -> None:
        """Uma ação da tecla deu erro: ela mostra a marca de erro por 1 s (config logging.key_error)."""
        if not isinstance(key, int) or not 1 <= key <= KEY_COUNT:
            return                                # automação (tecla 0) ou fora do Deck
        if page is not None and page != self._page:
            return                                # a página já mudou: a tecla na tela é outra
        if logs.setting(self.cfg.raw.get("logging"), "key_error", True) is False:
            return
        with self._lock:
            self._key_errors[key] = {"at": time.monotonic(), "until": None}
            self._dirty.add(key)
        klog.debug("Key %d shows the error mark for %g s", key, ERROR_MARK_S)

    @staticmethod
    def _mirror_combo(spec) -> str | None:
        """Combinação a segurar junto com a tecla no aperto (ação principal, só se a tecla não tem
        'hold', toque duplo nem repetição: nesses casos o aperto precisa esperar ou repetir)."""
        if spec.hold is not None or spec.double is not None or spec.repeat == "press":
            return None
        return Engine._mirror_of(spec.action)

    @staticmethod
    def _mirror_of(a) -> str | None:
        """Se a ação é uma combinação para segurar (bind com mirror, ou ação de plugin marcada como
        mirror, como as do Discord), devolve a combinação; senão None."""
        if not isinstance(a, dict) or not a.get("keys"):
            return None
        d = actions.REGISTRY.get(a.get("type"))
        if (a.get("type") == "bind" and a.get("mirror", True)) or (d is not None and d.mirror):
            return str(a["keys"])
        return None

    def _release_mirrored(self) -> None:
        """Solta combinações seguradas (ao sair/desconectar), para não deixar Ctrl/Shift presos."""
        for combo in self._mirrored.values():
            try:
                keys.key_up(combo)
            except Exception:
                klog.debug("Couldn't release %s", combo, exc_info=True)
        self._mirrored.clear()

    # -- gravar pela tecla do D6 -------------------------------------------------------
    # O editor arma uma combinação; a próxima tecla do D6 apertada manda só ela (segurada enquanto
    # a tecla estiver apertada), sem rodar a ação da tecla. Serve para o programa que está gravando
    # um atalho (Discord, OBS, um jogo) registrar a combinação, qualquer que seja a ação ou o plugin.
    def arm_record(self, combo: str, seconds: float = 30) -> None:
        self._record = {"combo": combo, "until": time.monotonic() + max(1.0, min(120.0, seconds))}

    def cancel_record(self) -> None:
        self._record = None

    def record_state(self) -> dict:
        r = self._record
        armed = bool(r and r["until"] > time.monotonic())
        return {"armed": armed, "left": round(r["until"] - time.monotonic()) if armed else 0, "sent": self._record_sent}

    def _on_key(self, key: int, pressed: bool) -> None:
        if not pressed and key in self._mirrored:
            # solta o que foi segurado, mesmo se a página mudou no meio
            keys.key_up(self._mirrored.pop(key))
        if not pressed and key in self._recorded:
            self._recorded.discard(key)
            return
        r = self._record
        if pressed and r and r["until"] > time.monotonic():
            self._record = None
            keys.key_down(r["combo"])
            self._mirrored[key] = r["combo"]
            self._recorded.add(key)
            self._record_sent = {"combo": r["combo"], "key": key, "at": time.time()}
            klog.info("Key %d sent the shortcut %s (record from the editor)", key, r["combo"])
            return
        # o D6 manda "apertou" de novo para uma tecla ainda segurada quando outra é tocada junto
        # (ele não suporta duas teclas ao mesmo tempo): ignora, senão a ação rodaria duas vezes
        if pressed and key in self._pressed:
            klog.debug("Key %d pressed again while held (page %s) -> ignored (D6 repeat)", key, self._page)
            return
        if not pressed and key in self._swallow:
            self._swallow.discard(key)
            klog.debug("Key %d released -> ignored (the press closed a temporary answer)", key)
            return
        if pressed and self._answer_press(key):
            self._swallow.add(key)
            klog.debug("Key %d pressed (page %s) -> closed a temporary answer", key, self._page)
            return
        spec = self.cfg.spec_at(self._page, key)[0]
        now = time.monotonic()
        self.light.on_key(key, pressed, spec.light if spec else None, self._key_color(spec), self._page, now)
        if spec is None:
            self._pressed.pop(key, None)
            if pressed:
                klog.debug("Key %d pressed (page %s) -> empty key", key, self._page)
            return
        if pressed:
            self._pressed[key] = now
            self._hold_fired.discard(key)
            tap = self._taps.pop(key, None)
            if tap is not None and spec.double is not None:
                self._doubled.add(key)                # 2º toque dentro da janela: toque duplo
                klog.debug("Key %d pressed again within %d ms (page %s) -> double tap", key, self.cfg.double_ms, self._page)
                self._submit(spec.double, key, "double")
                return
            if tap is not None:
                self._submit(tap["action"], key)      # (a tecla mudou no meio) roda o que estava esperando
            combo = self._mirror_combo(spec)
            if combo:
                # direto nesta thread (SendInput é instantâneo) para manter a ordem aperta/solta
                klog.debug("Key %d pressed (page %s) -> holding %s until released", key, self._page, combo)
                keys.key_down(combo)
                self._mirrored[key] = combo
            elif spec.repeat == "press" and spec.action is not None:
                # roda já e, se continuar segurando, repete (como uma tecla de teclado)
                klog.debug("Key %d pressed (page %s) -> runs now and repeats every %d ms while held",
                           key, self._page, spec.repeat_ms)
                self._submit(spec.action, key)
                self._repeat[key] = {"action": spec.action, "next": now + spec.repeat_delay / 1000,
                                     "every": spec.repeat_ms / 1000, "since": now, "n": 0, "moment": "repeat"}
            elif spec.hold is None and spec.double is None:
                if self._page_waits():
                    # página com toque duplo: todas as teclas esperam igual (a luz já reagiu)
                    klog.debug("Key %d pressed (page %s) -> single, waits %d ms (the page has double taps)",
                               key, self._page, self.cfg.double_ms)
                    self._deferred[key] = {"due": now + self.cfg.double_ms / 1000, "action": spec.action}
                else:
                    klog.debug("Key %d pressed (page %s) -> single (runs on press)", key, self._page)
                    self._submit(spec.action, key)   # responde já no aperto
            else:
                klog.debug("Key %d pressed (page %s), waiting: %s", key, self._page,
                           " / ".join(x for x, on in (("hold", spec.hold is not None), ("double tap", spec.double is not None)) if on))
        else:
            t0 = self._pressed.pop(key, None)
            ms = round((now - t0) * 1000) if t0 is not None else -1
            rep = self._repeat.pop(key, None)
            if key in self._doubled:                  # soltou o 2º toque: o duplo já rodou
                self._doubled.discard(key)
                klog.debug("Key %d released after %d ms (2nd tap of the double tap)", key, ms)
                self._submit(spec.release, key, "release")
                return
            short = t0 is not None and key not in self._hold_fired
            if short and spec.repeat != "press" and (spec.hold is not None or spec.double is not None):
                if spec.double is not None:
                    # toque simples: espera a janela para ver se vem o segundo
                    klog.debug("Key %d pressed (page %s), released after %d ms -> waiting %d ms for a double tap",
                               key, self._page, ms, self.cfg.double_ms)
                    self._taps[key] = {"due": now + self.cfg.double_ms / 1000, "action": spec.action}
                else:
                    klog.debug("Key %d pressed (page %s), released after %d ms -> single tap", key, self._page, ms)
                    self._submit(spec.action, key)   # toque curto
            elif rep is not None:
                klog.debug("Key %d released after %d ms (repeated %d times)", key, ms, rep.get("n", 0))
            elif key in self._hold_fired:
                klog.debug("Key %d released after %d ms (hold already ran)", key, ms)
            else:
                klog.debug("Key %d released after %d ms", key, ms)
            self._submit(spec.release, key, "release")

    def _answer_press(self, key: int) -> bool:
        """Tecla apertada durante uma resposta temporária. True = o aperto acabou aqui."""
        ov = self._overlay
        if ov is not None:
            if ov["dismiss"]:
                self._end_overlay()
            return not ov["passthrough"]
        t = self._temp
        if t is not None and self._page == t["page"]:
            if key == t.get("close_key"):
                self._end_temp()
                return True
            if t["dismiss"]:
                spec = self.cfg.spec_at(t["page"], key)[0]
                self._end_temp()
                if t["passthrough"] and spec is not None:
                    self._submit(spec.action, key)
                return True
        return False

    # -- respostas temporárias --------------------------------------------------------
    def paint_screens(self, icon: dict, seconds: float, dismiss: bool, passthrough: bool) -> None:
        with self._lock:
            self._overlay = {"icon": icon, "until": time.monotonic() + seconds, "dismiss": dismiss, "passthrough": passthrough}
            self._dirty = set(range(1, KEY_COUNT + 1))

    def _end_overlay(self) -> None:
        with self._lock:
            self._overlay = None
            self._dirty = set(range(1, KEY_COUNT + 1))

    def show_temp_page(self, page: str, seconds: float, dismiss: bool, passthrough: bool, show_left: bool, light) -> None:
        if page not in self.cfg.pages:
            raise ValueError(tr("page '{page}' doesn't exist", page=page))
        now = time.monotonic()
        with self._lock:
            ret = self._temp["ret"] if self._temp else self._page
            close = None
            if show_left:                              # a última tecla vazia vira "Fechar" com o tempo que falta
                for k in range(KEY_COUNT, 0, -1):
                    if self.cfg.spec_at(page, k)[0] is None:
                        close = k
                        break
            self._temp = {"page": page, "ret": ret, "until": now + seconds, "total": seconds,
                          "dismiss": dismiss, "passthrough": passthrough, "close_key": close}
            before = self._page
            self._page = page
            self._dirty = set(range(1, KEY_COUNT + 1))
            self._dyn.clear()
            self._key_errors.clear()
        log.info("Page changed: %s -> %s (temporary, %.0f s)", before, page, seconds)
        if light:
            self.flash_light(str(light), seconds, False)

    def _end_temp(self) -> None:
        t = self._temp
        if t is None:
            return
        with self._lock:
            self._temp = None
            if self._page == t["page"]:
                self._page = t["ret"] if t["ret"] in self.cfg.pages else self.cfg.home
                self._dirty = set(range(1, KEY_COUNT + 1))
                self._dyn.clear()
                self._key_errors.clear()
        log.info("Page changed: %s -> %s (temporary page ended)", t["page"], self._page)

    def flash_light(self, color: str, seconds: float, blink: bool) -> None:
        if not self.light.enabled:
            log.warning("Light answer ignored: the app doesn't control the light (Light > Control the Deck light)")
            return
        h = color.lstrip("#")
        try:
            rgb = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            rgb = (34, 197, 94)
        self._flash = {"rgb": rgb, "until": time.monotonic() + seconds, "blink": blink}

    def _check_answers(self) -> None:
        now = time.monotonic()
        if self._overlay is not None and now >= self._overlay["until"]:
            self._end_overlay()
        if self._temp is not None and now >= self._temp["until"]:
            self._end_temp()
        if self._flash is not None and now >= self._flash["until"]:
            self._flash = None
            self._led_sent = None
        if self._key_errors:
            with self._lock:
                for key, m in list(self._key_errors.items()):
                    # acabou o tempo, ou nunca chegou a desenhar (tecla presa, Deck fora): some
                    if (m["until"] is not None and now >= m["until"]) or now - m["at"] > 10:
                        del self._key_errors[key]
                        self._dirty.add(key)              # volta ao normal

    # -- teclas que mostram valores ----------------------------------------------------
    def _icon_for(self, key: int):
        """O ícone da tecla agora: resposta temporária, bloco, regras e valores já resolvidos."""
        ov = self._overlay
        if ov is not None:
            return ov["icon"]
        t = self._temp
        if t is not None and key == t.get("close_key") and self._page == t["page"]:
            left = max(0.0, t["until"] - time.monotonic())
            return {"lucide": "x", "text": tr("Close"), "bg": "#262d38", "style": "info",
                    "bar": {"pct": 100 * left / t["total"] if t["total"] else 0, "color": "#eceef2"}}
        spec, idx = self.cfg.spec_at(self._page, key)
        if spec is None:
            return None
        if spec.span != (1, 1) and spec.mode == "image":
            return {"__slice__": idx, "__anchor__": spec}
        if spec.span != (1, 1) and spec.cells:
            icon = dict(spec.cells[idx]) if idx < len(spec.cells) else {}
        else:
            active = spec.state is not None and self._states.get(spec.state, False)
            icon = dict(spec.active_icon if active else spec.icon)
        for rule in spec.rules:
            if values.test(rule.get("if"), self.values.get):
                icon.update(rule.get("icon") or {})
                break
        return self._resolve(icon) if spec.dynamic else icon

    def _resolve(self, icon: dict) -> dict:
        return values.resolve_icon(icon, self.values.get)

    def _block_slice(self, key: int, icon: dict):
        """Bloco "imagem contínua": a imagem cobre o bloco inteiro, pulando o vão entre as telas."""
        from PIL import Image, ImageOps
        spec, idx = icon["__anchor__"], icon["__slice__"]
        cols, rows = spec.span
        gap = int((self.cfg.raw.get("device") or {}).get("gap_px", 28))
        tile = icons.SIZE
        src = (spec.icon or {}).get("image")
        if not src:
            return icons.render_icon(spec.icon, self.cfg.base_dir)
        path = icons._image_path({"image": src}, self.cfg.base_dir)
        try:
            mtime = path.stat().st_mtime
        except OSError:
            mtime = 0
        ck = (str(path), mtime, cols, rows, gap)
        if ck not in self._slices:
            w, h = cols * tile + (cols - 1) * gap, rows * tile + (rows - 1) * gap
            try:
                big = ImageOps.fit(Image.open(path).convert("RGB"), (w, h), Image.Resampling.LANCZOS)
            except (OSError, ValueError) as e:
                logs.get("icons").warning("Couldn't open the block image %s: %s", path, e)
                return icons.render_icon({"text": "?"}, self.cfg.base_dir)
            self._slices[ck] = big
            if len(self._slices) > 8:
                self._slices.pop(next(iter(self._slices)))
        big = self._slices[ck]
        c, r = idx % cols, idx // cols
        x, y = c * (tile + gap), r * (tile + gap)
        return big.crop((x, y, x + tile, y + tile))

    def _refresh_dynamic(self) -> None:
        """Duas vezes por segundo: redesenha só as teclas cujos valores mudaram."""
        now = time.monotonic()
        if now - self._dyn_at < 0.5:
            return
        self._dyn_at = now
        if self._overlay is not None:
            return
        for key in range(1, KEY_COUNT + 1):
            spec = self.cfg.spec_at(self._page, key)[0]
            if spec is None or not spec.dynamic:
                continue
            sig = repr(sorted((self._icon_for(key) or {}).items(), key=str))
            if self._dyn.get(key) != sig:
                self._dyn[key] = sig
                with self._lock:
                    self._dirty.add(key)
        t = self._temp
        if t is not None and t.get("close_key"):
            with self._lock:
                self._dirty.add(t["close_key"])

    def _page_waits(self) -> bool:
        return any(s.double is not None for s in self.cfg.page_keys(self._page).values())

    def _run_timers(self) -> None:
        """Toques simples esperando o toque duplo, apertos adiados e repetições."""
        now = time.monotonic()
        for store in (self._taps, self._deferred):
            for key, item in list(store.items()):
                if now >= item["due"]:
                    del store[key]
                    if store is self._taps:
                        klog.debug("Key %d: no second tap within %d ms -> single tap", key, self.cfg.double_ms)
                    self._submit(item["action"], key)
        for key, r in list(self._repeat.items()):
            # para se a tecla soltou ou se um "soltou" se perdeu (nunca repetir para sempre)
            if key not in self._pressed or now - r["since"] > 30:
                del self._repeat[key]
                continue
            if now >= r["next"]:
                r["n"] = r.get("n", 0) + 1
                self._submit(r["action"], key, r.get("moment", "repeat"))
                r["next"] = max(r["next"] + r["every"], now + r["every"] / 2)

    @property
    def _timers_busy(self) -> bool:
        return bool(self._taps or self._deferred or self._repeat)

    def _check_holds(self) -> None:
        now = time.monotonic()
        for key, t0 in list(self._pressed.items()):
            if key in self._hold_fired:
                continue
            spec = self.cfg.spec_at(self._page, key)[0]
            if spec and spec.hold is not None and spec.repeat != "press" and (now - t0) * 1000 >= spec.hold_ms:
                self._hold_fired.add(key)
                if spec.repeat == "hold":
                    # "ao segurar" repetindo: roda agora e de novo a cada repeat_ms até soltar
                    klog.debug("Key %d held %d ms -> hold, repeating every %d ms", key, spec.hold_ms, spec.repeat_ms)
                    self._submit(spec.hold, key, "hold")
                    self._repeat[key] = {"action": spec.hold, "next": now + spec.repeat_ms / 1000,
                                         "every": spec.repeat_ms / 1000, "since": now, "n": 0, "moment": "hold"}
                    continue
                combo = self._mirror_of(spec.hold)
                if combo:
                    # "ao segurar" com atalho para segurar: aperta agora e só solta junto com a tecla
                    klog.debug("Key %d held %d ms -> hold, holding %s until released", key, spec.hold_ms, combo)
                    keys.key_down(combo)
                    self._mirrored[key] = combo
                else:
                    klog.debug("Key %d held %d ms -> hold", key, spec.hold_ms)
                    self._submit(spec.hold, key, "hold")

    # -- desenho ------------------------------------------------------------------

    def _still_for(self, key: int):
        """Imagem (PIL) da tecla agora; de um GIF, o primeiro quadro."""
        icon = self._icon_for(key)
        if icon is None:
            return icons.BLANK
        if "__slice__" in icon:
            return self._block_slice(key, icon)
        defaults = self.cfg.raw.get("icons")
        if not (icon or {}).get("image"):
            return icons.render_icon(icon, self.cfg.base_dir, defaults)
        return icons.render_frames(icon, self.cfg.base_dir, defaults)[0][0]

    def _frames_for(self, key: int) -> tuple[list[bytes], list[float]]:
        """JPEGs da tecla e a duração de cada um (s). Um só quadro se não for GIF animado."""
        if key in self._key_errors:
            return [render.encode(icons.error_mark(self._still_for(key)))], [0.0]
        icon = self._icon_for(key)
        if icon is None:
            return [render.encode(icons.BLANK)], [0.0]
        if "__slice__" in icon:
            return [render.encode(self._block_slice(key, icon))], [0.0]
        defaults = self.cfg.raw.get("icons")
        if not (icon or {}).get("image"):
            return [render.encode(icons.render_icon(icon, self.cfg.base_dir, defaults))], [0.0]
        # GIF: codificar todos os quadros custa; guarda o resultado por ícone + data do arquivo
        try:
            mtime = icons._image_path(icon, self.cfg.base_dir).stat().st_mtime
        except OSError:
            mtime = 0
        ck = repr((sorted(icon.items(), key=str), defaults, mtime))
        if ck not in self._frame_cache:
            frames = icons.render_frames(icon, self.cfg.base_dir, defaults)
            if len(self._frame_cache) > 24:
                self._frame_cache.clear()
            self._frame_cache[ck] = ([render.encode(img) for img, _ in frames],
                                     [ms / 1000 for _, ms in frames])
        return self._frame_cache[ck]

    def _flush_draws(self) -> None:
        with self._lock:
            dirty, self._dirty = self._dirty, set()
            bright = self._brightness if self._brightness_dirty else None
            self._brightness_dirty = False
        if bright is not None:
            self.deck.set_brightness(bright)
        if not dirty:
            return
        tiles: dict[int, bytes] = {}
        skipped: list[int] = []
        now = time.monotonic()
        t_render = time.monotonic()
        with self._lock:
            for key in sorted(dirty):
                jpegs, durations = self._frames_for(key)
                mark = self._key_errors.get(key)
                if mark is not None and mark["until"] is None:
                    mark["until"] = now + ERROR_MARK_S    # o 1 s conta a partir de quando aparece
                if len(jpegs) > 1:
                    old = self._anims.get(key)
                    if old is None or old["jpegs"] is not jpegs:
                        self._anims[key] = {"jpegs": jpegs, "durations": durations, "i": 0,
                                            "due": now + durations[0]}
                    else:
                        continue                      # o mesmo GIF já está tocando
                else:
                    self._anims.pop(key, None)
                data = jpegs[0]
                digest = hashlib.sha1(data).hexdigest()
                if self._sent.get(key) != digest:
                    tiles[key] = data
                    self._sent[key] = digest
                else:
                    skipped.append(key)
        if skipped:
            dlog.debug("Skipped redraw of keys %s (same image)", skipped)
        if tiles:
            t0 = time.monotonic()
            opts = dict(self.cfg.draw_options)
            if opts.pop("session", False):
                # modo antigo: abre uma sessão (a iluminação pisca); só por segurança
                self.deck.draw(tiles, brightness=self._brightness, **opts)
            else:
                for key in sorted(tiles, key=self.deck.screen_for_key):
                    self.deck.push(key, tiles[key])
            dlog.debug("Drew keys %s in %d ms (render %d ms, %d bytes)", sorted(tiles),
                       round((time.monotonic() - t0) * 1000), round((t0 - t_render) * 1000),
                       sum(len(b) for b in tiles.values()))

    # -- API usada pelo editor -------------------------------------------------------

    @property
    def page(self) -> str:
        return self._page

    @property
    def device_connected(self) -> bool:
        return self.deck is not None

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

    def obs_lists(self) -> dict:
        """Cenas e entradas do OBS (para os menus do editor)."""
        out = {"connected": False, "scenes": [], "inputs": [], "sources": {}}
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

    # -- loop principal -------------------------------------------------------------

    def _open_deck(self) -> bool:
        """Tenta abrir o D6. Devolve False se não estiver disponível."""
        try:
            deck = D6().open()
        except Exception as e:
            if not self._waiting_deck:
                dlog.info("Waiting for the Deck: %s", e, exc_info=not isinstance(e, RuntimeError))
                self._waiting_deck = True
            return False
        self._waiting_deck = False
        self.deck = deck
        self._led_sent = None
        self._apply_device_options()
        deck.enable_keys(self._brightness)
        with self._lock:
            self._sent.clear()                     # o D6 pode ter perdido as imagens
            self._dirty = set(range(1, KEY_COUNT + 1))
            self._pressed.clear()
        self.firmware = deck.firmware_version()
        self._key_errors.clear()
        info = deck.info or {}
        dlog.info("Deck connected: USB %04x:%04x, firmware %s, %s%s", info.get("vendor_id") or 0,
                  info.get("product_id") or 0, self.firmware or "?",
                  (info.get("product_string") or "Fifine D6").strip(),
                  f" (release {info['release_number']:#06x})" if info.get("release_number") else "",
                  extra={"ctx": {"interface": info.get("interface_number"), "usage_page": info.get("usage_page"),
                                 "manufacturer": info.get("manufacturer_string") or None}})
        if self._lost_at is not None:
            dlog.debug("The Deck was away for %.1f s", time.monotonic() - self._lost_at)
        self._lost_at = None
        logs.resolve("device.disconnected")
        self.automations.on_connected()
        return True

    def device_info(self) -> dict:
        """Dados do aparelho para o pacote de diagnóstico."""
        info = (self.deck.info if self.deck is not None else None) or {}
        return {"connected": self.deck is not None, "firmware": self.firmware,
                "usb": f"{info.get('vendor_id') or 0:04x}:{info.get('product_id') or 0:04x}" if info else None,
                "product": info.get("product_string"), "release": info.get("release_number")}

    def _close_deck(self) -> None:
        self._release_mirrored()
        self._anims.clear()
        if self.deck is not None:
            try:
                self.deck.close()
            except Exception:
                dlog.debug("Closing the Deck failed (it was probably unplugged)", exc_info=True)
            self.deck = None
            self._lost_at = time.monotonic()

    def _advance_animations(self) -> None:
        """Manda o próximo quadro de cada GIF cuja hora chegou (um envio curto por quadro)."""
        if not self._anims:
            return
        now = time.monotonic()
        for key, a in list(self._anims.items()):
            if now < a["due"]:
                continue
            a["i"] = (a["i"] + 1) % len(a["jpegs"])
            data = a["jpegs"][a["i"]]
            self.deck.push(key, data)
            self._sent[key] = hashlib.sha1(data).hexdigest()
            a["due"] += a["durations"][a["i"]]
            if a["due"] < now:                       # atrasou muito (desenho longo): ressincroniza
                a["due"] = now + a["durations"][a["i"]]

    # -- luz (anel de LEDs) --------------------------------------------------------

    @staticmethod
    def _key_color(spec) -> str | None:
        """Cor de fundo da tecla, usada pela reação "na cor da tecla"."""
        if spec is None:
            return None
        bg = (spec.icon or {}).get("bg")
        return bg if isinstance(bg, str) and bg.startswith("#") and len(bg) == 7 else None

    def _hold_ms(self, key: int) -> int:
        spec = self.cfg.spec_at(self._page, key)[0]
        return spec.hold_ms if spec else 500

    def _update_leds(self) -> None:
        """Manda o próximo quadro do anel. Sem a seção 'lighting:' no config, não mexe na luz."""
        if not self.light.enabled:
            return
        now = time.monotonic()
        s = self.light.settings(self._page)
        if s.get("off_with_screen") and now - self._screen_checked > 2.0:
            self._screen_checked = now
            self._screen_off = winutil.screen_off()
        self.light.check_holds(self._hold_ms, self._page, now)
        animating = self.light.animating(self._page)
        if animating and now - self._led_at < 1 / 30:
            return
        f = self._flash
        if f is not None:                                  # resposta temporária na luz
            on = not f["blink"] or int((f["until"] - now) * 3) % 2 == 0
            frame = [f["rgb"] if on else (0, 0, 0)] * lighting.N
        else:
            frame = [(0, 0, 0)] * lighting.N if (self._screen_off and s.get("off_with_screen")) else self.light.frame(self._page, now)
        # reenvia o mesmo quadro de vez em quando: depois dos dois cliques no botão de trás,
        # a luz do app volta sozinha
        if frame != self._led_sent or now - self._led_at > 1.5:
            self.deck.set_leds(frame)
            self._led_sent, self._led_at = frame, now

    def leds_now(self) -> list | None:
        """Último quadro mandado ao anel (para a prévia do editor)."""
        return self._led_sent

    def _tick(self) -> None:
        timeout = 30
        if self._anims:
            wait = min(a["due"] for a in self._anims.values()) - time.monotonic()
            timeout = max(1, min(30, int(wait * 1000)))
        if self.light.enabled and self.light.animating(self._page):
            timeout = min(timeout, 15)
        if self._timers_busy:
            timeout = min(timeout, 10)
        for ev in self.deck.events(timeout_ms=timeout):
            self._on_key(ev.key, ev.pressed)
        self._check_holds()
        self._run_timers()
        self._check_answers()
        self._refresh_dynamic()
        self.automations.tick()
        # não redesenha com tecla apertada: o envio demora e atrasaria o 'soltar'
        # (ignora apertos "presos" há mais de 5 s, caso um 'soltar' se perca)
        now = time.monotonic()
        if not any(now - t < 5 for t in self._pressed.values()):
            self._flush_draws()
        self._advance_animations()
        self._update_leds()

    def run(self) -> None:
        """Loop principal. Termina com stop() ou Ctrl+C. Reconecta se o D6 sumir."""
        self._stop_event.clear()
        self._sync_plugins()
        log.info("Running with %s (page %s)", self.config_path.name, self._page)
        last_reload_check = 0.0
        try:
            while not self._stop_event.is_set():
                now = time.monotonic()
                if now - last_reload_check > 1.0:
                    last_reload_check = now
                    self._reload_if_changed()
                if self.deck is None:
                    if not self._open_deck():
                        self._check_disconnected()
                        self._stop_event.wait(2)
                    continue
                try:
                    self._tick()
                except (OSError, ValueError, IOError) as e:
                    # erro de HID = D6 desconectado, PC voltando da suspensão etc.
                    dlog.warning("Deck connection lost (%s); reconnecting", e)
                    self._close_deck()
        finally:
            from app.plugins import MANAGER
            MANAGER.stop_all()
            self._pool.shutdown(wait=False, cancel_futures=True)
            self._close_deck()
            logs.resolve("device.disconnected")
            log.info("Stopped")

    def _check_disconnected(self) -> None:
        """Sem o Deck por mais de alguns segundos (ou não achado ao abrir): problema em aberto."""
        if self._lost_at is not None and time.monotonic() - self._lost_at >= DISCONNECTED_PROBLEM:
            logs.problem("device.disconnected", "The Deck is disconnected")
