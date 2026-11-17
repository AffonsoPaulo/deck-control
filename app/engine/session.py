"""A conexão com o Deck: abrir, cair, fechar e o problema em aberto quando ele some.

Só a conversa com o aparelho em si. O que o resto do engine faz ao conectar ou cair (redesenhar tudo, soltar
combinações seguradas, avisar as automações) quem liga é o Engine, na ordem de sempre.

Threads: open/close/check_disconnected só no laço do engine; `deck`, `firmware` e info() também são lidos pelo
editor e pela bandeja.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

from app import logs
from app.engine.core import Clock
from d6.device import D6

if TYPE_CHECKING:
    from app.config import Config

dlog = logs.get("device")  # USB: conectar, desconectar, desenhar

DISCONNECTED_PROBLEM = 5.0  # s sem o Deck até virar um problema em aberto


class Session:
    def __init__(self, clock: Clock, device: Callable[[], D6]) -> None:
        self._clock = clock
        self._device = device  # a classe D6 (ou o D6 falso dos testes)
        self.deck: D6 | None = None
        self.firmware: str | None = None
        self._waiting_deck = False
        self._lost_at: float | None = clock.monotonic()  # desde quando está sem o Deck (None = conectado)

    def open(self) -> D6 | None:
        """Tenta abrir o D6. Devolve None se não estiver disponível."""
        try:
            deck = self._device().open()
        except Exception as e:
            if not self._waiting_deck:
                dlog.info("Waiting for the Deck: %s", e, exc_info=not isinstance(e, RuntimeError))
                self._waiting_deck = True
            return None
        self._waiting_deck = False
        self.deck = deck
        return deck

    def apply_options(self, cfg: Config) -> None:
        if self.deck is not None:
            self.deck.settle = float((cfg.raw.get("device") or {}).get("settle", 1.0))

    def read_firmware(self) -> None:
        if self.deck is not None:
            self.firmware = self.deck.firmware_version()

    def connected(self) -> None:
        """Registra a conexão (no log e no problema em aberto), depois de o Deck estar pronto."""
        info = (self.deck.info if self.deck is not None else None) or {}
        dlog.info(
            "Deck connected: USB %04x:%04x, firmware %s, %s%s",
            info.get("vendor_id") or 0,
            info.get("product_id") or 0,
            self.firmware or "?",
            (info.get("product_string") or "Fifine D6").strip(),
            f" (release {info['release_number']:#06x})" if info.get("release_number") else "",
            extra={
                "ctx": {
                    "interface": info.get("interface_number"),
                    "usage_page": info.get("usage_page"),
                    "manufacturer": info.get("manufacturer_string") or None,
                }
            },
        )
        if self._lost_at is not None:
            dlog.debug("The Deck was away for %.1f s", self._clock.monotonic() - self._lost_at)
        self._lost_at = None
        logs.resolve("device.disconnected")

    def close(self) -> None:
        if self.deck is not None:
            try:
                self.deck.close()
            except Exception:
                dlog.debug("Closing the Deck failed (it was probably unplugged)", exc_info=True)
            self.deck = None
            self._lost_at = self._clock.monotonic()

    def check_disconnected(self) -> None:
        """Sem o Deck por mais de alguns segundos (ou não achado ao abrir): problema em aberto."""
        if self._lost_at is not None and self._clock.monotonic() - self._lost_at >= DISCONNECTED_PROBLEM:
            logs.problem("device.disconnected", "The Deck is disconnected")

    def info(self) -> dict[str, Any]:
        """Dados do aparelho para o pacote de diagnóstico."""
        info = (self.deck.info if self.deck is not None else None) or {}
        return {
            "connected": self.deck is not None,
            "firmware": self.firmware,
            "usb": f"{info.get('vendor_id') or 0:04x}:{info.get('product_id') or 0:04x}" if info else None,
            "product": info.get("product_string"),
            "release": info.get("release_number"),
        }
