"""Experimento: manda GIF cru (sem converter para JPEG) para o D6.

Tecla 14: GIF estático (testa se o D6 decodifica GIF).
Tecla 15: GIF animado de 3 quadros (testa se ele anima sozinho).

Uso: python tools/gif_test.py   (feche o app do D6 antes)
"""
from __future__ import annotations

import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image  # noqa: E402

from d6 import render  # noqa: E402
from d6.device import D6  # noqa: E402

SIZE = render.TILE


def frame(text: str, bg) -> Image.Image:
    # gira 180° como as imagens normais (a tela é montada de cabeça para baixo)
    return render.text_tile(text, bg, size=SIZE).rotate(180).convert("P", palette=Image.Palette.ADAPTIVE, colors=32)


def gif_bytes(frames: list[Image.Image], duration: int = 400) -> bytes:
    buf = io.BytesIO()
    if len(frames) == 1:
        frames[0].save(buf, format="GIF")
    else:
        frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:], duration=duration, loop=0, disposal=1)
    return buf.getvalue()


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    static = gif_bytes([frame("GIF", (200, 160, 0))])
    animated = gif_bytes([frame("1", (200, 40, 40)), frame("2", (40, 160, 60)), frame("3", (40, 80, 200))])
    print(f"GIF estático: {len(static)} bytes, começa com {static[:6]!r}")
    print(f"GIF animado: {len(animated)} bytes, começa com {animated[:6]!r}")
    with D6() as deck:
        deck.settle = 0.5
        deck.draw({14: static, 15: animated}, per_key_session=False, key_delay=0.1)
    print("Enviado. Olhe as teclas 14 e 15 (as duas últimas da fileira de baixo).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
