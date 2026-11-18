"""A correção da cor das telas do D6 (d6.render.screen_correct e device.screen_color)."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from app.config import sections
from app.errors import ConfigError
from app.config.load import build_config
from d6 import render

P = Path("config.yaml")


def px(color, *args):
    return render.screen_correct(Image.new("RGB", (8, 8), color), *args).getpixel((4, 4))


def test_grays_white_and_black_stay_as_they_are():
    for c in ((0, 0, 0), (255, 255, 255), (85, 85, 85), (48, 48, 48), (200, 200, 205)):
        assert px(c, *sections.SCREEN_COLOR) == c


def test_purple_gets_less_blue_more_red_on_the_d6():
    r, g, b = px((0x4A, 0x14, 0x8C), *sections.SCREEN_COLOR)
    assert r > 0x4A and b < 0x8C  # o roxo deixa de sair azul na tela do D6


def test_no_correction_is_the_same_image():
    img = Image.new("RGB", (8, 8), (0x4A, 0x14, 0x8C))
    assert render.screen_correct(img) is img


def test_config_default_on_off_and_custom():
    assert sections.screen_color({}) == sections.SCREEN_COLOR
    assert sections.screen_color({"device": {"screen_color": False}}) is None
    assert sections.screen_color({"device": {"screen_color": {"red": 0.9}}}) == (
        0.9,
        *sections.SCREEN_COLOR[1:],
    )


@pytest.mark.parametrize("value", ["sim", {"red": 5}, {"saturation": "x"}])
def test_bad_screen_color_is_a_problem(value):
    with pytest.raises(ConfigError, match="screen_color"):
        build_config({"pages": {"main": {}}, "device": {"screen_color": value}}, P)


def test_the_engine_sends_corrected_colors_when_asked(make_engine):
    from tests.fakes.deck import decode

    rig = make_engine(
        """
language: en
device: {screen_color: {red: 0.82, blue: 1.45, saturation: 1.3}}
pages:
  main:
    1: {icon: {bg: "#4A148C"}, action: {type: none, tag: a}}
"""
    )
    rig.connect()
    r, g, b = decode(rig.deck.screens[1]).convert("RGB").getpixel((2, 2))
    assert r > 0x4A + 10 and b < 0x8C - 10
