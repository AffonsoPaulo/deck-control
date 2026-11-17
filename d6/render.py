"""Geração das imagens das teclas (JPEG no formato que o D6 aceita).

Regras do hardware (ver d6/device.py):
  * JPEG baseline, sem restart markers (DRI / RSTn); o Pillow já gera assim.
  * 112x112 px, girado 180° (a tela é montada de cabeça para baixo).
    Medido com tools/calibrate.py em 2026-11-14 (firmware V3.D6.1.009): imagens
    menores (85 ou 100, valores dos projetos de referência) ficam encostadas no
    canto inferior direito, e o D6 preenche a sobra em cima/à esquerda.
  * Tamanho: até ~16 KB aparece certo; 20 KB já sai com defeito e de 24 KB
    para cima o D6 descarta (medido com tools/size_test.py em 2026-11-15).
    Mantemos até 12 KB, com margem.
  * Cor em resolução inteira (4:4:4) funciona e deixa texto e bordas bem mais
    nítidos que o 4:2:0 padrão (tools/quality_test.py, 2026-11-15).
"""

from __future__ import annotations

import io

from PIL import Image, ImageDraw, ImageFont

TILE = 112
MAX_BYTES = 12000

_FONT_CANDIDATES = ("segoeuib.ttf", "arialbd.ttf", "segoeui.ttf", "arial.ttf")


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def text_tile(
    text: str,
    bg: tuple[int, int, int],
    fg: tuple[int, int, int] = (255, 255, 255),
    size: int = TILE,
    font_size: int | None = None,
) -> Image.Image:
    """Quadrado colorido com um texto centralizado."""
    img = Image.new("RGB", (size, size), bg)
    draw = ImageDraw.Draw(img)
    fs = font_size or size // 2  # o laço abaixo reduz até caber na largura
    font = _font(fs)
    while fs > 8:
        box = draw.textbbox((0, 0), text, font=font)
        if box[2] - box[0] <= size - 8:
            break
        fs -= 2
        font = _font(fs)
    draw.text((size / 2, size / 2), text, font=font, fill=fg, anchor="mm")
    return img


def fit(img: Image.Image, size: int = TILE) -> Image.Image:
    """Redimensiona qualquer imagem para o quadrado da tecla (com fundo preto)."""
    img = img.convert("RGBA")
    img.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2), img)
    return canvas


def encode(img: Image.Image, size: int = TILE, rotate: int = 180, max_bytes: int = MAX_BYTES) -> bytes:
    """Converte para o JPEG que vai para o D6 (baixando a qualidade até caber)."""
    if img.size != (size, size):
        img = fit(img, size)
    img = img.convert("RGB")
    if rotate:
        img = img.rotate(rotate)
    data = b""
    # primeiro baixa a qualidade com a cor inteira; só então reduz a cor pela metade
    for subsampling in (0, 2):
        for quality in (95, 90, 85, 80, 70, 60, 50, 40, 30, 20):
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality, subsampling=subsampling, optimize=False, progressive=False)
            data = buf.getvalue()
            if len(data) <= max_bytes:
                return data
    return data
