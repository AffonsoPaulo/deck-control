"""As teclas do D6: apertar, soltar, segurar, toque duplo e repetir, e as combinações seguradas junto com a tecla.

Aqui se decide o que cada aperto e cada soltar faz; o que tem de esperar o relógio (a janela do toque duplo, o
aperto adiado, a repetição) vai para o app/engine/timers.py.

Threads: tudo no laço do engine (é nele que os eventos das teclas chegam do aparelho); forget_pressed também, com
a trava, quando o Deck reconecta.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Mapping

from app import actions, logs
from app.windows import keys
from app.engine.core import Shared, Submit
from app.engine.leds import Leds
from app.engine.navigation import Navigation
from app.engine.recorder import Recorder
from app.engine.timers import Timers

if TYPE_CHECKING:
    from app.config.model import KeySpec

klog = logs.get("keys")  # aperto/soltura e a decisão (toque, duplo, segurar, repetir)

STUCK_S = 5  # tecla "apertada" há mais que isso: um 'soltar' se perdeu, não segura mais o desenho


class Input:
    def __init__(
        self,
        shared: Shared,
        nav: Navigation,
        timers: Timers,
        leds: Leds,
        recorder: Recorder,
        submit: Submit,
        mark: Callable[[int], None] = lambda key: None,
    ) -> None:
        self._shared = shared
        self._mark = mark  # marca a tecla para redesenhar (a fila de desenho)
        self._nav = nav
        self._timers = timers
        self._leds = leds
        self._recorder = recorder
        self._submit = submit
        self.pressed: dict[int, float] = {}  # tecla -> momento em que foi apertada
        # tecla -> página em que foi apertada: o soltar é da tecla apertada, mesmo que o aperto tenha trocado de
        # página (senão a tecla da mesma posição na página nova rodaria como toque curto)
        self._press_page: dict[int, str] = {}
        self._hold_fired: set[int] = set()
        self._mirrored: dict[int, str] = {}  # tecla -> combinação segurada (ação 'bind')
        self._doubled: set[int] = set()  # teclas cujo 2º toque já rodou o 'double'
        self._swallow: set[int] = set()  # teclas que só fecharam uma resposta (o soltar não roda nada)
        self.sunk: dict[int, float] = {}  # teclas mostrando a tela encolhida (apertadas) -> desde quando
        self._sink_pending: set[int] = set()  # encolheram e ainda não foram para o Deck

    # -- combinações seguradas
    @staticmethod
    def mirror_combo(spec: KeySpec) -> str | None:
        """Combinação a segurar junto com a tecla no aperto (ação principal, só se a tecla não tem
        'hold', toque duplo nem repetição: nesses casos o aperto precisa esperar ou repetir)."""
        if spec.hold is not None or spec.double is not None or spec.repeat == "press":
            return None
        return Input.mirror_of(spec.action)

    @staticmethod
    def mirror_of(a: Any) -> str | None:
        """Se a ação é uma combinação para segurar (bind com mirror, ou ação de plugin marcada como
        mirror, como as do Discord), devolve a combinação; senão None."""
        if not isinstance(a, dict) or not a.get("keys"):
            return None
        registry: Mapping[Any, actions.ActionDef] = actions.REGISTRY  # procura com o 'type' do config, seja o que for
        d = registry.get(a.get("type"))
        if (a.get("type") == "bind" and a.get("mirror", True)) or (d is not None and d.mirror):
            return str(a["keys"])
        return None

    def release_mirrored(self) -> None:
        """Solta combinações seguradas (ao sair/desconectar), para não deixar Ctrl/Shift presos."""
        for combo in self._mirrored.values():
            try:
                keys.key_up(combo)
            except Exception:
                klog.debug("Couldn't release %s", combo, exc_info=True)
        self._mirrored.clear()

    # -- estado das teclas
    def forget_pressed(self) -> None:
        """O Deck (re)conectou: nenhuma tecla está apertada (quem chama segura a trava)."""
        self.pressed.clear()
        self._press_page.clear()
        self.sunk.clear()
        self._sink_pending.clear()

    # -- a tecla encolhe ao apertar (config icons.press_shrink, ligado por padrão)
    def _shrink_on(self) -> bool:
        raw = self._shared.cfg.raw.get("icons")
        value = raw.get("press_shrink", True) if isinstance(raw, dict) else True
        return value if isinstance(value, bool) else True

    def _sink(self, key: int, now: float) -> None:
        if self._shrink_on():
            self.sunk[key] = now
            self._sink_pending.add(key)
            self._mark(key)

    def _unsink(self, key: int) -> bool:
        """A tecla volta ao normal (redesenha). Devolve se estava encolhida."""
        if self.sunk.pop(key, None) is None:
            return False
        self._sink_pending.discard(key)
        self._mark(key)
        return True

    def expire_sunk(self, now: float) -> None:
        """Um 'soltar' perdido não deixa a tecla encolhida para sempre (mesma regra dos 5 s do desenho)."""
        for key, t in list(self.sunk.items()):
            if now - t >= STUCK_S:
                self._unsink(key)

    def drawable_while_held(self, now: float) -> set[int]:
        """Com tecla apertada, só estas redesenham: a que acabou de encolher e as apertadas que não seguram
        uma combinação ("apertar para falar": o soltar dela não pode esperar um envio)."""
        live = {k for k, t in self.pressed.items() if now - t < STUCK_S}
        return self._sink_pending | (live - set(self._mirrored))

    def drawn(self, keys: set[int]) -> None:
        """O laço mandou essas teclas para o Deck."""
        self._sink_pending -= keys

    def holding(self, now: float) -> bool:
        """Alguma tecla apertada agora (ignora apertos "presos" há mais de 5 s, caso um 'soltar' se perca)."""
        return any(now - t < STUCK_S for t in self.pressed.values())

    def _page_waits(self) -> bool:
        return any(s.double is not None for s in self._shared.cfg.page_keys(self._nav.page).values())

    # -- eventos do D6
    def on_key(self, key: int, pressed: bool) -> None:
        if not pressed:
            # volta ao normal em qualquer caminho do soltar (resposta fechada, página trocada, gravação...)
            self._unsink(key)
        if not pressed and key in self._mirrored:
            # solta o que foi segurado, mesmo se a página mudou no meio
            keys.key_up(self._mirrored.pop(key))
        if not pressed and self._recorder.swallow_release(key):
            return
        if pressed:
            combo = self._recorder.take_press(key)
            if combo is not None:
                self._mirrored[key] = combo
                return
        # o D6 manda "apertou" de novo para uma tecla ainda segurada quando outra é tocada junto
        # (ele não suporta duas teclas ao mesmo tempo): ignora, senão a ação rodaria duas vezes
        if pressed and key in self.pressed:
            klog.debug("Key %d pressed again while held (page %s) -> ignored (D6 repeat)", key, self._nav.page)
            return
        if not pressed and key in self._swallow:
            self._swallow.discard(key)
            klog.debug("Key %d released -> ignored (the press closed a temporary answer)", key)
            return
        if pressed and self._nav.answer_press(key):
            self._swallow.add(key)
            self._sink(key, self._shared.clock.monotonic())  # a tecla que só fecha também encolhe
            klog.debug("Key %d pressed (page %s) -> closed a temporary answer", key, self._nav.page)
            return
        if pressed:
            page = self._press_page[key] = self._nav.page
        else:
            page = self._press_page.pop(key, self._nav.page)
            if page != self._nav.page:
                klog.debug(
                    "Key %d released on page %s, pressed on page %s -> it is that key's release",
                    key,
                    self._nav.page,
                    page,
                )
        spec = self._shared.cfg.spec_at(page, key)[0] if page in self._shared.cfg.pages else None
        now = self._shared.clock.monotonic()
        self._leds.on_key(key, pressed, spec, now)
        if spec is None:
            self.pressed.pop(key, None)
            if pressed:
                klog.debug("Key %d pressed (page %s) -> empty key", key, self._nav.page)
            return
        if pressed:
            self._on_press(key, spec, now)
        else:
            self._on_release(key, spec, now, page)

    def _on_press(self, key: int, spec: KeySpec, now: float) -> None:
        cfg = self._shared.cfg
        self.pressed[key] = now
        self._sink(key, now)
        self._hold_fired.discard(key)
        tap = self._timers.take_tap(key)
        if tap is not None and spec.double is not None:
            self._doubled.add(key)  # 2º toque dentro da janela: toque duplo
            klog.debug("Key %d pressed again within %d ms (page %s) -> double tap", key, cfg.double_ms, self._nav.page)
            self._submit(spec.double, key, "double")
            return
        if tap is not None:
            self._submit(tap["action"], key)  # (a tecla mudou no meio) roda o que estava esperando
        combo = self.mirror_combo(spec)
        if combo:
            # direto nesta thread (SendInput é instantâneo) para manter a ordem aperta/solta
            klog.debug("Key %d pressed (page %s) -> holding %s until released", key, self._nav.page, combo)
            keys.key_down(combo)
            self._mirrored[key] = combo
        elif spec.repeat == "press" and spec.action is not None:
            # roda já e, se continuar segurando, repete (como uma tecla de teclado)
            klog.debug(
                "Key %d pressed (page %s) -> runs now and repeats every %d ms while held",
                key,
                self._nav.page,
                spec.repeat_ms,
            )
            self._submit(spec.action, key)
            self._timers.start_repeat(
                key, spec.action, now + spec.repeat_delay / 1000, spec.repeat_ms / 1000, now, "repeat"
            )
        elif spec.hold is None and spec.double is None:
            if self._page_waits():
                # página com toque duplo: todas as teclas esperam igual (a luz já reagiu)
                klog.debug(
                    "Key %d pressed (page %s) -> single, waits %d ms (the page has double taps)",
                    key,
                    self._nav.page,
                    cfg.double_ms,
                )
                self._timers.defer(key, now + cfg.double_ms / 1000, spec.action)
            else:
                klog.debug("Key %d pressed (page %s) -> single (runs on press)", key, self._nav.page)
                self._submit(spec.action, key)  # responde já no aperto
        else:
            klog.debug(
                "Key %d pressed (page %s), waiting: %s",
                key,
                self._nav.page,
                " / ".join(
                    x for x, on in (("hold", spec.hold is not None), ("double tap", spec.double is not None)) if on
                ),
            )

    def _on_release(self, key: int, spec: KeySpec, now: float, page: str) -> None:
        cfg = self._shared.cfg
        t0 = self.pressed.pop(key, None)
        ms = round((now - t0) * 1000) if t0 is not None else -1
        rep = self._timers.stop_repeat(key)
        if key in self._doubled:  # soltou o 2º toque: o duplo já rodou
            self._doubled.discard(key)
            klog.debug("Key %d released after %d ms (2nd tap of the double tap)", key, ms)
            self._submit(spec.release, key, "release")
            return
        short = t0 is not None and key not in self._hold_fired
        if short and spec.repeat != "press" and (spec.hold is not None or spec.double is not None):
            if spec.double is not None:
                # toque simples: espera a janela para ver se vem o segundo
                klog.debug(
                    "Key %d pressed (page %s), released after %d ms -> waiting %d ms for a double tap",
                    key,
                    self._nav.page,
                    ms,
                    cfg.double_ms,
                )
                self._timers.wait_double(key, now + cfg.double_ms / 1000, spec.action)
            else:
                klog.debug("Key %d pressed (page %s), released after %d ms -> single tap", key, self._nav.page, ms)
                self._submit(spec.action, key)  # toque curto
        elif rep is not None:
            klog.debug("Key %d released after %d ms (repeated %d times)", key, ms, rep.get("n", 0))
        elif key in self._hold_fired:
            klog.debug("Key %d released after %d ms (hold already ran)", key, ms)
        else:
            klog.debug("Key %d released after %d ms", key, ms)
        if self._timers.defer_release(key, spec.release, page):
            klog.debug("Key %d: 'release' waits for the deferred press", key)
            return
        self._submit(spec.release, key, "release")

    def check_holds(self) -> None:
        now = self._shared.clock.monotonic()
        for key, t0 in list(self.pressed.items()):
            if key in self._hold_fired:
                continue
            # o segurar é da tecla apertada (o aperto pode ter trocado de página)
            page = self._press_page.get(key, self._nav.page)
            spec = self._shared.cfg.spec_at(page, key)[0] if page in self._shared.cfg.pages else None
            if spec and spec.hold is not None and spec.repeat != "press" and (now - t0) * 1000 >= spec.hold_ms:
                self._hold_fired.add(key)
                if spec.repeat == "hold":
                    # "ao segurar" repetindo: roda agora e de novo a cada repeat_ms até soltar
                    klog.debug("Key %d held %d ms -> hold, repeating every %d ms", key, spec.hold_ms, spec.repeat_ms)
                    self._submit(spec.hold, key, "hold")
                    self._timers.start_repeat(
                        key, spec.hold, now + spec.repeat_ms / 1000, spec.repeat_ms / 1000, now, "hold"
                    )
                    continue
                combo = self.mirror_of(spec.hold)
                if combo:
                    # "ao segurar" com atalho para segurar: aperta agora e só solta junto com a tecla
                    klog.debug("Key %d held %d ms -> hold, holding %s until released", key, spec.hold_ms, combo)
                    keys.key_down(combo)
                    self._mirrored[key] = combo
                else:
                    klog.debug("Key %d held %d ms -> hold", key, spec.hold_ms)
                    self._submit(spec.hold, key, "hold")
