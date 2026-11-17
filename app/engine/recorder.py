"""Gravar pela tecla do D6.

O editor arma uma combinação; a próxima tecla do D6 apertada manda só ela (segurada enquanto a tecla estiver
apertada), sem rodar a ação da tecla. Serve para o programa que está gravando um atalho (Discord, OBS, um jogo)
registrar a combinação, qualquer que seja a ação ou o plugin.

Threads: arm/cancel/state vêm do editor; take_press/swallow_release, do laço do engine.
"""

from __future__ import annotations

from typing import Any

from app import keys, logs
from app.engine.core import Clock

klog = logs.get("keys")


class Recorder:
    def __init__(self, clock: Clock) -> None:
        self._clock = clock
        self._record: dict[str, Any] | None = None  # "enviar pelo Deck": {combo, until}
        self._recorded: set[int] = set()  # teclas usadas para gravar (o soltar não roda nada)
        self._record_sent: dict[str, Any] | None = None  # último envio: {combo, key, at}

    def arm(self, combo: str, seconds: float = 30) -> None:
        self._record = {"combo": combo, "until": self._clock.monotonic() + max(1.0, min(120.0, seconds))}

    def cancel(self) -> None:
        self._record = None

    def state(self) -> dict[str, Any]:
        r = self._record
        armed = bool(r and r["until"] > self._clock.monotonic())
        return {
            "armed": armed,
            "left": round(r["until"] - self._clock.monotonic()) if r is not None and armed else 0,
            "sent": self._record_sent,
        }

    def swallow_release(self, key: int) -> bool:
        """Soltou a tecla que gravou: True = o soltar acabou aqui (não roda nada)."""
        if key in self._recorded:
            self._recorded.discard(key)
            return True
        return False

    def take_press(self, key: int) -> str | None:
        """Tecla apertada com a gravação armada: aperta a combinação e a devolve (quem chamou a segura até a
        tecla soltar). None = não estava armada; o aperto segue normal."""
        r = self._record
        if not (r and r["until"] > self._clock.monotonic()):
            return None
        self._record = None
        combo: str = r["combo"]
        keys.key_down(combo)
        self._recorded.add(key)
        self._record_sent = {"combo": combo, "key": key, "at": self._clock.time()}
        klog.info("Key %d sent the shortcut %s (record from the editor)", key, combo)
        return combo
