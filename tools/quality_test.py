"""Experimento: compara a qualidade do JPEG nas teclas.

Fileira de cima:  como era (até 2,3 KB, cor pela metade)
Fileira do meio:  qualidade 95, cor pela metade (4:2:0)
Fileira de baixo: qualidade 95, cor inteira (4:4:4)

Uso: python tools/quality_test.py   (feche o app do D6 antes)
"""
from __future__ import annotations

import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image, ImageDraw  # noqa: E402

from app import icons  # noqa: E402
from d6 import render  # noqa: E402
from d6.device import D6  # noqa: E402

S = render.TILE


def gradient() -> Image.Image:
    img = Image.new("RGB", (S, S))
    px = img.load()
    for y in range(S):
        for x in range(S):
            px[x, y] = (int(255 * x / S), int(255 * y / S), int(255 * (1 - x / S)))
    d = ImageDraw.Draw(img)
    d.text((S / 2, S / 2), "Degradê", font=render._font(18), fill="white", anchor="mm")
    return img


def lines() -> Image.Image:
    img = Image.new("RGB", (S, S), (20, 20, 20))
    d = ImageDraw.Draw(img)
    for i in range(0, S, 4):
        d.line([(i, 0), (i, S)], fill=(255, 60, 60) if i % 8 else (60, 200, 255))
    d.text((S / 2, S / 2), "Linhas", font=render._font(20), fill="white", anchor="mm", stroke_width=3, stroke_fill="black")
    return img


SAMPLES = [
    icons.render_icon({"glyph": "E7C8", "text": "Gravar", "bg": "#C62828"}),
    icons.render_icon({"glyph": "E720", "text": "Microfone", "bg": "#1565C0"}),
    icons.render_icon({"text": "Texto pequeno colorido", "text_size": 13, "bg": "#FFEB3B", "fg": "#6A1B9A"}),
    gradient(),
    lines(),
]


def jpeg(img, quality, subsampling) -> bytes:
    buf = io.BytesIO()
    img.rotate(180).save(buf, format="JPEG", quality=quality, subsampling=subsampling, optimize=False, progressive=False)
    return buf.getvalue()


def main() -> int:
    with D6() as deck:
        deck.enable_keys(100)
        for col, img in enumerate(SAMPLES):
            rows = [render.encode(img), jpeg(img, 95, 2), jpeg(img, 95, 0)]
            for row, data in enumerate(rows):
                key = row * 5 + col + 1
                deck.push(key, data)
                print(f"tecla {key:2}: {len(data):5} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
