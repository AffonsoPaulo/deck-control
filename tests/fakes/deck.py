"""Aparelho falso: faz o papel do d6.device.D6 para o Engine, sem USB.

Guarda tudo o que o engine manda (imagens de cada tecla, quadros do anel, brilho) e entrega os eventos de tecla
que o teste enfileira. O d6 não tem um Protocol do aparelho; o DeckProtocol abaixo é o que o engine usa dele
hoje (o test_engine_fakes.py confere que o D6 de verdade tem tudo isso, para o falso não ficar para trás).
"""

from __future__ import annotations

import io
from collections import deque
from typing import TYPE_CHECKING, Any, Callable, Iterator, Protocol, Self

from PIL import Image

from d6.device import D6, KEY_COUNT, LED_COUNT, KeyEvent


class DeckProtocol(Protocol):
    """O que o engine (app/engine/) usa do aparelho."""

    settle: float

    def open(self) -> Self: ...
    def close(self) -> None: ...
    @property
    def info(self) -> dict: ...
    def enable_keys(self, brightness: int = 100) -> None: ...
    def firmware_version(self) -> str | None: ...
    def set_brightness(self, pct: int) -> None: ...
    def events(self, timeout_ms: int = 500) -> Iterator[KeyEvent]: ...
    def push(self, key: int, jpeg: bytes) -> None: ...
    def sleep(self) -> None: ...
    def set_leds(self, colors: Any) -> None: ...
    @staticmethod
    def screen_for_key(key: int) -> int: ...


def decode(jpeg: bytes) -> Image.Image:
    """JPEG mandado ao D6 -> imagem na posição de quem olha (o render.encode gira 180°)."""
    return Image.open(io.BytesIO(jpeg)).convert("RGB").rotate(180)


class FakeDeck:
    """D6 de mentira. Os campos públicos são o registro do que o engine fez."""

    @staticmethod
    def screen_for_key(key: int) -> int:
        return D6.screen_for_key(key)  # a mesma conta do aparelho (linhas invertidas)

    def __init__(self, firmware: str = "V3.D6.1.009"):
        self.settle = 1.0
        self._firmware = firmware
        self._events: deque[tuple[int, bool]] = deque()
        self.opened = False
        self.closed = False
        self.enabled: list[int] = []  # brilho de cada enable_keys (uma vez por conexão)
        self.brightness: list[int] = []  # set_brightness
        self.pushes: list[tuple[int, bytes]] = []  # (tecla, JPEG) em ordem de envio
        self.screens: dict[int, bytes] = {}  # tecla -> última imagem
        self.leds: list[list[tuple[int, int, int]]] = []  # quadros do anel, em ordem
        self.slept = 0  # sleep() (HAN): as telas dormindo
        self.reads: list[int] = []  # timeout_ms de cada events()
        # roteiro de leitura: cada item é chamado no events() correspondente (antes de entregar os eventos);
        # pode levantar (cabo puxado) ou parar o engine
        self.script: list[Callable[[], None] | None] = []
        # trava de segurança para os testes que rodam o run() de verdade: um loop que não para vira erro
        self.max_reads = 5000

    # -- o que o engine usa
    def open(self) -> "FakeDeck":
        self.opened = True
        return self

    def close(self) -> None:
        self.closed = True

    @property
    def info(self) -> dict:
        return {"vendor_id": 0x3142, "product_id": 0x0060, "product_string": "Fake D6", "interface_number": 0}

    def enable_keys(self, brightness: int = 100) -> None:
        self.enabled.append(brightness)

    def firmware_version(self) -> str | None:
        return self._firmware

    def set_brightness(self, pct: int) -> None:
        self.brightness.append(pct)

    def events(self, timeout_ms: int = 500) -> Iterator[KeyEvent]:
        self.reads.append(timeout_ms)
        if len(self.reads) > self.max_reads:
            raise AssertionError(f"events() chamado mais de {self.max_reads} vezes: o loop não parou")
        if self.script:
            step = self.script.pop(0)
            if step is not None:
                step()
        out = [KeyEvent(key=k, pressed=p, timestamp=0.0) for k, p in self._events]
        self._events.clear()
        return iter(out)

    def push(self, key: int, jpeg: bytes) -> None:
        assert 1 <= key <= KEY_COUNT, key
        self.pushes.append((key, jpeg))
        self.screens[key] = jpeg

    def sleep(self) -> None:
        assert not self.closed, "sleep() depois de fechar"
        self.slept += 1

    def set_leds(self, colors: Any) -> None:
        assert len(colors) == LED_COUNT
        self.leds.append([tuple(c) for c in colors])

    # -- o que o teste usa
    def queue(self, key: int, pressed: bool) -> None:
        """Enfileira um evento para o próximo events()."""
        self._events.append((key, pressed))

    def pushed_keys(self) -> list[int]:
        return [k for k, _ in self.pushes]

    def clear_log(self) -> None:
        self.pushes.clear()
        self.leds.clear()
        self.brightness.clear()

    def center(self, key: int) -> tuple[int, int, int]:
        """Cor do pixel do meio da última imagem da tecla."""
        img = decode(self.screens[key])
        r, g, b = img.getpixel((img.width // 2, img.height // 2))  # type: ignore[misc]
        return (r, g, b)

    def pixel(self, key: int, x: int, y: int) -> tuple[int, int, int]:
        r, g, b = decode(self.screens[key]).getpixel((x, y))  # type: ignore[misc]
        return (r, g, b)


class FakeDeckFactory:
    """Faz o papel da classe D6 (o `device` do Engine): cada D6() devolve um FakeDeck novo (ou o próximo
    preparado)."""

    def __init__(self) -> None:
        self.made: list[FakeDeck] = []
        self.ready: list[FakeDeck] = []
        self.fail: list[Exception] = []  # o próximo D6() levanta isto (aparelho não achado)

    def __call__(self) -> FakeDeck:
        if self.fail:
            raise self.fail.pop(0)
        deck = self.ready.pop(0) if self.ready else FakeDeck()
        self.made.append(deck)
        return deck

    def prepare(self) -> FakeDeck:
        deck = FakeDeck()
        self.ready.append(deck)
        return deck


if TYPE_CHECKING:  # o mypy confere que o FakeDeck segue o DeckProtocol
    _fake_is_a_deck: DeckProtocol = FakeDeck()
