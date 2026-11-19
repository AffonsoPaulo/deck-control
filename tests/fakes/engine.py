"""Montagem do Engine de verdade com aparelho falso, relógio falso e ações espionadas (para os test_engine_*).

O EngineRig é o único lugar dos testes que chama partes internas do engine: _open_deck (conectar sem o loop
do run()), _tick (uma volta do loop) e _pool (as ações rodam na hora, na mesma thread, em vez do pool de
threads). Os testes olham só o efeito: ações que rodaram, imagens e luz mandadas ao aparelho, página e estados.
"""

from __future__ import annotations

from concurrent.futures import Future
from dataclasses import dataclass, field
from typing import Any, Callable

from app import actions
from app.engine import Engine
from tests.fakes.clock import FakeClock
from tests.fakes.deck import FakeDeck, FakeDeckFactory

# ações que mexem só no próprio engine (página, estados, contagens, respostas): rodam de verdade.
# As outras (atalho, programa, comando, http...) só ficam registradas.
INTERNAL_ACTIONS = {
    "none",
    "page",
    "page.temp",
    "screens.paint",
    "light.flash",
    "timer.toggle",
    "timer.reset",
    "toggle",
    "set_state",
    "brightness",
    "multi",
    "if",
}


@dataclass
class Ran:
    """Uma ação que o engine mandou rodar."""

    tag: str  # o campo 'tag' da ação (marcador dos testes) ou o tipo
    moment: str  # press | double | hold | release | repeat | automation | test
    key: int
    page: str
    at: float  # relógio falso (s)
    spec: dict = field(repr=False, default_factory=dict)


class StubPlugins:
    """Gerenciador de plugins vazio: o run() liga e desliga plugins, e os de verdade são globais."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def secret_values(self, cfg: dict) -> list[str]:
        return []

    def attach(self, engine: Any) -> None:
        self.calls.append("attach")

    def sync(self, cfg: dict) -> None:
        self.calls.append("sync")

    def stop_all(self) -> None:
        self.calls.append("stop_all")

    def instance(self, plugin_id: str) -> None:
        return None


class InlineExecutor:
    """No lugar do ThreadPoolExecutor do engine: roda a ação na hora, na thread de quem pediu.

    Diferença de propósito: no app a ação roda em paralelo com o loop; aqui ela termina antes do engine seguir.
    """

    def __init__(self) -> None:
        self.shutdowns: list[dict] = []

    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Future:
        f: Future = Future()
        try:
            f.set_result(fn(*args, **kwargs))
        except BaseException as e:  # o actions.run já engole os erros das ações; isto é só por garantia
            f.set_exception(e)
        return f

    def shutdown(self, wait: bool = True, cancel_futures: bool = False) -> None:
        self.shutdowns.append({"wait": wait, "cancel_futures": cancel_futures})


class FakeStopEvent:
    """No lugar do _stop_event do engine (threading.Event): o wait(2) do run() esperando o Deck faz o relógio
    falso andar, em vez de esperar de verdade."""

    def __init__(self, clock: FakeClock, hooks: list[Callable[[], None]] | None = None) -> None:
        self.clock = clock
        self._set = False
        self.waits: list[float | None] = []
        self.hooks = list(hooks or [])  # chamados um por wait(), em ordem (ex.: engine.resume)

    def set(self) -> None:
        self._set = True

    def clear(self) -> None:
        self._set = False

    def is_set(self) -> bool:
        return self._set

    def wait(self, timeout: float | None = None) -> bool:
        self.waits.append(timeout)
        if timeout:
            self.clock.advance(timeout * 1000)
        if self.hooks:
            self.hooks.pop(0)()
        return self._set


class EngineRig:
    def __init__(
        self,
        engine: Engine,
        clock: FakeClock,
        factory: FakeDeckFactory,
        ran: list[Ran],
        pressed: list[tuple[str, str]],
    ) -> None:
        self.engine = engine
        self.clock = clock
        self.factory = factory
        self.ran = ran  # ações que rodaram, em ordem
        self.keys = pressed  # teclado do PC: ("press" | "down" | "up" | "type", combinação ou texto)

    @property
    def pool(self) -> InlineExecutor:
        """O executor que faz o papel do pool de ações (interno: _pool), para ver como o run() o fecha."""
        pool = self.engine._pool
        assert isinstance(pool, InlineExecutor)
        return pool

    @property
    def deck(self) -> FakeDeck:
        deck = self.engine.deck
        assert isinstance(deck, FakeDeck), "o Deck não está conectado"
        return deck

    # -- conexão e loop
    def connect(self) -> FakeDeck:
        """Conecta como o run() faz quando o Deck aparece (interno: _open_deck) e desenha as teclas."""
        assert self.engine._open_deck()
        self.tick()
        return self.deck

    def tick(self) -> None:
        """Uma volta do loop principal (interno: _tick)."""
        self.engine._tick()

    def run(self, on_wait: list[Callable[[], None]] | None = None) -> FakeStopEvent:
        """O run() de verdade (conectar, loop, reconectar, parar), com a espera trocada (interno: _stop_event).
        Quem para o loop é o roteiro do FakeDeck (deck.script) chamando engine.stop(). on_wait: chamados um a
        cada espera do loop (sem o Deck, ou com o PC dormindo)."""
        stop = FakeStopEvent(self.clock, on_wait)
        self.engine._stop_event = stop  # type: ignore[assignment]
        self.engine.run()
        return stop

    def advance(self, ms: float, step: float = 10) -> None:
        """O tempo passa em passos de `step` ms, com uma volta do loop a cada passo (como o app, a cada ~10 ms)."""
        left = ms
        while left > 1e-9:
            d = min(step, left)
            self.clock.advance(d)
            self.tick()
            left -= d

    # -- teclas do D6
    def press(self, key: int) -> None:
        self.deck.queue(key, True)
        self.tick()

    def release(self, key: int) -> None:
        self.deck.queue(key, False)
        self.tick()

    def tap(self, key: int, ms: float = 50) -> None:
        """Aperta, segura `ms` e solta."""
        self.press(key)
        self.advance(ms)
        self.release(key)

    # -- o que aconteceu
    def moments(self) -> list[tuple[str, str]]:
        """[(tag, momento)] das ações que rodaram."""
        return [(r.tag, r.moment) for r in self.ran]

    def clear(self) -> None:
        self.ran.clear()
        self.keys.clear()
        if self.engine.deck is not None:
            self.deck.clear_log()


def spy_run(ran: list[Ran], clock: FakeClock, real_run: Callable[[Any, Any], None]) -> Callable[[Any, Any], None]:
    """No lugar de app.actions.run: registra cada ação e só roda de verdade as internas do engine."""

    def run(spec: Any, ctx: Any) -> None:
        norm = actions.normalize(spec)
        if not norm:
            return
        tag = str(norm.get("tag") or norm.get("type"))
        ran.append(Ran(tag, ctx.moment, ctx.key, ctx.page, clock.monotonic(), dict(norm)))
        if norm.get("type") in INTERNAL_ACTIONS:
            real_run(spec, ctx)

    return run
