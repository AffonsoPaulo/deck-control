"""Experimento: qual o maior JPEG que o D6 aceita por tecla?

Primeiro pinta todas as teclas de cinza com "-", depois manda em cada tecla uma
imagem numerada, com tamanho crescente (inflado com segmentos de comentário
JPEG, que não mudam a imagem). As recusadas continuam com "-".

Uso: python tools/size_test.py   (feche o app do D6 antes)
"""

from __future__ import annotations

import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from d6 import render  # noqa: E402
from d6.device import D6  # noqa: E402

SIZES = [2300, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 16000, 20000, 24000, 32000, 40000, 50000, 60000]


def padded(jpeg: bytes, target: int) -> bytes:
    """Insere comentários (FFFE) logo depois do SOI até chegar no tamanho pedido."""
    extra = target - len(jpeg)
    segs = b""
    while extra > 4:
        n = min(extra - 4, 65533)  # dados do segmento
        segs += b"\xff\xfe" + struct.pack(">H", n + 2) + b"\x00" * n
        extra -= n + 4
    return jpeg[:2] + segs + jpeg[2:]


def main() -> int:
    with D6() as deck:
        deck.enable_keys(100)
        blank = render.encode(render.text_tile("-", (60, 60, 60)))
        for key in range(1, 16):
            deck.push(key, blank)
        for key, size in enumerate(SIZES, start=1):
            label = f"{size / 1000:g}K"
            data = padded(render.encode(render.text_tile(label, (30, 110, 200))), size)
            deck.push(key, data)
            print(f"tecla {key}: {len(data)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
