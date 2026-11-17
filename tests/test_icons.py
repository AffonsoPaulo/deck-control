"""Desenho das teclas.

Sem comparar a imagem inteira com uma de referência: as fontes de texto vêm do Windows e mudam de máquina para
máquina. Os testes conferem o que não depende da fonte (tamanho, fundo, cor do texto, borda, ícone Lucide).
"""

from __future__ import annotations

import pytest

from app import icons

SIZE = icons.SIZE


def colors(img) -> set:
    return {c for _, c in img.getcolors(maxcolors=SIZE * SIZE)}


def test_empty_key_is_a_plain_square():
    img = icons.render_icon(None)
    assert img.size == (SIZE, SIZE)
    assert img.mode == "RGB"
    assert colors(img) == {(0x20, 0x20, 0x20)}


def test_background_color():
    img = icons.render_icon({"bg": "#1d2330"})
    assert img.getpixel((0, 0)) == (0x1D, 0x23, 0x30)


def test_border_is_drawn_on_the_edge():
    img = icons.render_icon({"bg": "#1d2330", "border": "#ff0000"})
    assert img.getpixel((0, 0)) == (255, 0, 0)
    assert img.getpixel((SIZE // 2, SIZE // 2)) == (0x1D, 0x23, 0x30)


@pytest.mark.parametrize(
    ("spec", "fg"),
    [
        ({"bg": "#1d2330"}, icons.WHITE),  # grafite: branco dá contraste
        ({"bg": "#b4232a"}, icons.WHITE),  # vermelho
        ({"bg": "#f5b301"}, icons.DARK_FG),  # âmbar: branco não chega a 3:1
        ({"bg": "#ffffff"}, icons.DARK_FG),
        ({"bg": "#f5b301", "bg_to": "#b4232a"}, icons.WHITE),  # degradê fica branco
        ({"bg": "#ffffff", "image": "x.png", "image_fill": True}, icons.WHITE),
    ],
)
def test_auto_text_color(spec, fg):
    assert icons._auto_fg(spec, icons._color(spec["bg"], None)) == fg


def test_auto_fg_threshold_is_3_to_1():
    # o primeiro cinza em que o branco cai abaixo de 3:1 passa para o texto escuro
    for v in range(256):
        rgb = (v, v, v)
        white_contrast = 1.05 / (icons._luminance(rgb) + 0.05)
        assert (icons._auto_fg({}, rgb) == icons.WHITE) == (white_contrast >= 3)


def test_text_uses_the_chosen_color():
    img = icons.render_icon({"bg": "#000000", "fg": "#00ff00", "text": "OK"})
    assert (0, 255, 0) in colors(img)


def test_text_on_amber_is_dark():
    img = icons.render_icon({"bg": "#f5b301", "text": "OK"})
    assert icons.DARK_FG in colors(img)
    assert icons.WHITE not in colors(img)


def test_lucide_icon_is_drawn():
    assert icons.lucide_code("mic") is not None
    assert icons.lucide_code("not-an-icon") is None
    plain = icons.render_icon({"bg": "#000000"})
    with_icon = icons.render_icon({"bg": "#000000", "lucide": "mic"})
    assert colors(plain) == {(0, 0, 0)}
    assert icons.WHITE in colors(with_icon)


def test_merge_icon_overrides_only_given_fields():
    assert icons.merge_icon({"text": "a", "bg": "#000"}, {"bg": "#fff"}) == {"text": "a", "bg": "#fff"}
