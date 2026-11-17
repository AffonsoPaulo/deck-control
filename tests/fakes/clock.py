"""Relógio falso: faz o papel do módulo `time` nos módulos do app que medem tempo.

Os testes trocam o `time` importado em app/engine.py, app/values.py e app/automations.py por um FakeClock
(nunca o `time` global: pytest e as threads do Python continuam com o relógio de verdade). O tempo só anda
quando o teste manda (advance), ou num sleep() de quem está usando o relógio.
"""

from __future__ import annotations

import time as _real_time
from typing import Any


class FakeClock:
    """monotonic(), time(), perf_counter() e sleep() falsos; o resto (localtime, strftime...) vem do `time` de
    verdade. localtime()/strftime() sem argumento usam a hora falsa (relógio e data das teclas)."""

    def __init__(self, start: float = 1000.0, wall: float = 1_800_000_000.0):
        # começa longe de 0: vários campos do engine começam em 0.0 ("nunca aconteceu")
        self._us = round(start * 1_000_000)  # em microssegundos inteiros: somar passos não acumula erro
        self._wall_offset = float(wall) - float(start)
        self.sleeps: list[float] = []

    # -- o que o app usa
    def monotonic(self) -> float:
        return self._us / 1_000_000

    def perf_counter(self) -> float:
        return self.monotonic()

    def time(self) -> float:
        return self.monotonic() + self._wall_offset

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.advance(seconds * 1000)

    def localtime(self, secs: float | None = None) -> _real_time.struct_time:
        return _real_time.localtime(self.time() if secs is None else secs)

    def strftime(self, fmt: str, t: Any = None) -> str:
        return _real_time.strftime(fmt, self.localtime() if t is None else t)

    def __getattr__(self, name: str) -> Any:
        return getattr(_real_time, name)

    # -- o que o teste usa
    def advance(self, ms: float) -> None:
        self._us += round(ms * 1000)

    def set_wall(self, wall: float) -> None:
        """Muda a hora de parede (time/localtime) sem mexer no monotonic."""
        self._wall_offset = float(wall) - self.monotonic()
