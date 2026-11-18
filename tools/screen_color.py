"""Calibração da cor das telas do D6, por curva em cada canal.

A tela exagera o azul nos tons escuros e médios e acerta no máximo (o branco fica bom sem correção, o roxo escuro
sai azul). A correção é uma curva: azul^gb (gb > 1: diminui o azul baixo, o 255 não muda) e vermelho^gr (gr < 1:
reforça o vermelho baixo). Cada COLUNA é um nível; escolhe-se o que deixa os roxos certos sem o cinza virar marrom.

    Fileira de cima:   o roxo #4A148C
    Fileira do meio:   o azul-violeta #5865F2
    Fileira de baixo:  cinza #555555 (tem de continuar cinza)

Rodadas anteriores: só o vermelho reforçado (o roxo só melhorou muito forte); menos azul por porcentagem (o roxo
melhorou, mas o branco amarelou: na tela, o branco fica melhor sem correção).

Só imagens: nenhuma ação roda. O app precisa estar fechado (o Deck aceita um dono por vez); ao abrir de novo, ele
redesenha as teclas.

Uso: python tools/screen_color.py [--preview arquivo.png]
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image, ImageDraw  # noqa: E402

from d6 import render  # noqa: E402
from d6.device import D6  # noqa: E402

# 4ª rodada: a curva escolhida (roxo na coluna 3, azul na 4: o meio-termo 0,66 / 1,8) e o reforço de saturação
# crescendo por coluna, só nas cores fortes (render.screen_correct). O cinza tem de ficar cinza em todas.
# 5ª rodada: o meio-termo deixou o roxo rosa (vermelho demais). Cada fileira tem a sua curva (cor, vermelho, azul).
LEVELS = (1.0, 1.15, 1.3, 1.45, 1.6)
ROWS = (
    ((0x4A, 0x14, 0x8C), 0.72, 1.6),  # roxo, curva da coluna 3 (a escolhida na 3ª rodada)
    ((0x4A, 0x14, 0x8C), 0.82, 1.45),  # roxo, curva mais suave
    ((0x58, 0x65, 0xF2), 0.72, 1.6),  # azul-violeta com a mesma curva da 1ª fileira
)


def tile(color: tuple[int, int, int], label: str, size: int = render.TILE) -> Image.Image:
    img = Image.new("RGB", (size, size), color)
    d = ImageDraw.Draw(img)
    dark = sum(color) / 3 > 160
    d.text((size / 2, size - 6), label, font=render._font(16), fill=(0, 0, 0) if dark else (255, 255, 255), anchor="mb")
    return img


def tiles() -> dict[int, Image.Image]:
    out: dict[int, Image.Image] = {}
    for row, (base, red, blue) in enumerate(ROWS):
        for i, sat in enumerate(LEVELS):
            k = row * 5 + i + 1
            out[k] = render.screen_correct(tile(base, str(i + 1)), red, blue, sat)  # o número é o da coluna
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", help="só salva a grade neste PNG, sem enviar")
    args = ap.parse_args()
    t = tiles()
    if args.preview:
        s = render.TILE
        grid = Image.new("RGB", (s * 5 + 40, s * 3 + 20), (20, 20, 20))
        for k, img in t.items():
            grid.paste(img, (((k - 1) % 5) * (s + 10), ((k - 1) // 5) * (s + 10)))
        grid.save(args.preview)
        print("salvo em", args.preview)
        return 0
    # como o app: liga o modo de teclas uma vez e troca as imagens sem sessão (a sessão faz o Deck piscar)
    brightness = 100
    try:
        import yaml

        cfg = yaml.safe_load(
            open(
                os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.yaml"),
                encoding="utf-8",
            )
        )
        brightness = int(cfg.get("brightness", 100))
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    with D6() as deck:
        deck.enable_keys(brightness)
        for k in sorted(t, key=deck.screen_for_key):
            deck.push(k, render.encode(t[k]))
    print("Enviado. Diga a fileira e a coluna do roxo mais certo, e se o azul de baixo continua bom.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
