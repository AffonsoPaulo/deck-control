"""Fase 2: desenha um quadrado colorido com o número da tecla em cada tela.

Uso:
    python tools/draw_test.py                 # todas as 15 teclas
    python tools/draw_test.py --keys 1 5 11 15
    python tools/draw_test.py --chunk 512     # variante de tamanho de pedaço
    python tools/draw_test.py --batch         # uma sessão só (mais rápido, menos confiável)

Cada execução gasta um "ciclo de desenho" do D6. Se ele parar de mostrar
imagens, tire e recoloque o cabo.
"""

from __future__ import annotations

import argparse
import colorsys
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from d6 import render  # noqa: E402
from d6.device import KEY_COUNT, D6  # noqa: E402


def color_for(key: int) -> tuple[int, int, int]:
    r, g, b = colorsys.hsv_to_rgb((key - 1) / KEY_COUNT, 0.85, 0.9)
    return int(r * 255), int(g * 255), int(b * 255)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", type=int, nargs="*", default=list(range(1, KEY_COUNT + 1)))
    ap.add_argument("--chunk", type=int, default=None, help="bytes de imagem por pacote (padrão: 1024)")
    ap.add_argument("--size", type=int, default=render.TILE)
    ap.add_argument("--batch", action="store_true", help="todas as imagens numa sessão só")
    ap.add_argument("--clear", action="store_true", help="limpa as telas antes")
    ap.add_argument("--brightness", type=int, default=100)
    ap.add_argument("--key-delay", type=float, default=0.3, help="pausa depois de cada imagem (s)")
    ap.add_argument("--pace", type=float, default=0.005, help="pausa entre pacotes (s)")
    ap.add_argument("--prefix", default="", help="texto antes do número (para distinguir testes)")
    ap.add_argument("--invert", action="store_true", help="fundo branco, número colorido")
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    tiles = {}
    for k in args.keys:
        bg, fg = (color_for(k), (255, 255, 255)) if not args.invert else ((255, 255, 255), color_for(k))
        img = render.text_tile(f"{args.prefix}{k}", bg, fg, size=args.size)
        tiles[k] = render.encode(img, size=args.size)
    sizes = ", ".join(f"{k}:{len(v)}B" for k, v in tiles.items())
    print(f"Imagens {args.size}x{args.size}: {sizes}")

    with D6() as deck:
        t0 = time.time()
        deck.draw(
            tiles,
            brightness=args.brightness,
            chunk=args.chunk,
            per_key_session=not args.batch,
            clear=args.clear,
            key_delay=args.key_delay,
            pace=args.pace,
        )
        print(f"Enviado em {time.time() - t0:.1f}s. Olhe o D6.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
