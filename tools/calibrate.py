"""Padrão de calibração: mostra quais pixels de cada tela ficam visíveis.

Faixas de 5 px a partir da borda, cada uma de uma cor:
    0-4 vermelho | 5-9 laranja | 10-14 amarelo | 15-19 verde | 20-24 ciano | 25-29 azul
Centro branco com uma cruz preta no pixel 50,50 e marcas em 'C' (cima) e 'E' (esquerda).
Tirando uma foto de frente, dá para ler quantos pixels somem em cada lado.

Uso: python tools/calibrate.py [--keys 1 8 15] [--size 100]
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image, ImageDraw  # noqa: E402

from d6 import render  # noqa: E402
from d6.device import D6  # noqa: E402

BANDS = [(230, 0, 0), (255, 140, 0), (255, 230, 0), (0, 200, 0), (0, 220, 230), (0, 60, 255)]


def pattern(size: int = 100) -> Image.Image:
    img = Image.new("RGB", (size, size), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for i, color in enumerate(BANDS):
        o = i * 5
        d.rectangle([o, o, size - 1 - o, size - 1 - o], fill=color)
    o = len(BANDS) * 5
    d.rectangle([o, o, size - 1 - o, size - 1 - o], fill=(255, 255, 255))
    c = size // 2
    d.line([(c, o), (c, size - 1 - o)], fill=(0, 0, 0), width=1)
    d.line([(o, c), (size - 1 - o, c)], fill=(0, 0, 0), width=1)
    font = render._font(12)
    d.text((c, o + 2), "C", font=font, fill=(0, 0, 0), anchor="mt")
    d.text((o + 2, c), "E", font=font, fill=(0, 0, 0), anchor="lm")
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", type=int, nargs="*", default=[1, 8, 15])
    ap.add_argument("--size", type=int, default=render.TILE)
    ap.add_argument("--preview", help="só salva o padrão neste arquivo PNG, sem enviar")
    args = ap.parse_args()

    img = pattern(args.size)
    if args.preview:
        img.resize((args.size * 4, args.size * 4), Image.Resampling.NEAREST).save(args.preview)
        print("salvo em", args.preview)
        return 0
    data = render.encode(img, size=args.size)
    print(f"Padrão {args.size}x{args.size}: {len(data)} bytes, teclas {args.keys}")
    with D6() as deck:
        for k in sorted(args.keys, key=deck.screen_for_key):  # envio rápido, sem sessão
            deck.push(k, data)
    print("Enviado. Tire uma foto de frente e bem de perto.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
