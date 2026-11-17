"""Valores ao vivo nos textos ({clock.hour}), condições e faixas de cor."""

from __future__ import annotations

import pytest

from app import values

DATA = {"clock.hour": "09", "cpu": 42.0, "temp": "21,5°", "obs.recording": True, "name": "Ana", "zero": "0"}
get = DATA.get


def test_render_replaces_tokens():
    assert values.render("{clock.hour}h", get) == "09h"


@pytest.mark.parametrize(
    ("text", "out"),
    [
        ("{clock.hour|nz}", "9"),
        ("{name|up}", "ANA"),
        ("{name|low}", "ana"),
        ("{cpu}%", "42%"),
        ("{missing}", "–"),
        ("{obs.recording}", "yes"),
    ],
)
def test_render_formats(text, out):
    assert values.render(text, get) == out


def test_render_leaves_non_text_alone():
    assert values.render(None, get) is None
    assert values.render(5, get) == 5


def test_single_returns_the_raw_value():
    assert values.single("{cpu}", get) == 42.0
    assert values.single(" {cpu} ", get) == 42.0
    assert values.single("{cpu}%", get) == "{cpu}%"
    assert values.single("{missing}", get) is None


def test_has_tokens():
    assert values.has_tokens("a {b} c")
    assert not values.has_tokens("sem nada")
    assert not values.has_tokens(None)


@pytest.mark.parametrize(
    ("cond", "expected"),
    [
        ({"value": "cpu", "op": "gt", "to": 40}, True),
        ({"value": "cpu", "op": "lt", "to": 40}, False),
        ({"value": "cpu", "op": "ge", "to": "42"}, True),
        ({"value": "temp", "op": "gt", "to": 21}, True),  # "21,5°" vira 21.5
        ({"value": "name", "op": "eq", "to": " ana "}, True),
        ({"value": "name", "op": "ne", "to": "Bia"}, True),
        ({"value": "name", "op": "contains", "to": "n"}, True),
        ({"value": "obs.recording", "op": "eq", "to": True}, True),
        ({"value": "obs.recording", "op": "eq", "to": "sim"}, True),
        ({"value": "obs.recording", "op": "ne", "to": True}, False),
        ({"value": "name", "op": "gt", "to": 3}, False),  # não é número
        ({"value": "cpu"}, True),  # sem op: o valor é verdadeiro?
        ({"value": "zero"}, False),
        ({"value": "missing"}, False),
        ({"value": ""}, False),
        ("não é condição", False),
    ],
)
def test_conditions(cond, expected):
    assert values.test(cond, get) is expected


def test_check_cond_messages():
    assert values.check_cond({"value": "cpu", "op": "gt"}, "x") == []
    assert values.check_cond({}, "pages.main.1") == ["pages.main.1: a condition needs 'value'"]
    (msg,) = values.check_cond({"value": "cpu", "op": "bigger"}, "w")
    assert msg.startswith("w: unknown operator 'bigger'")


@pytest.mark.parametrize(
    ("v", "color"),
    [(10, "green"), (50, "green"), (51, "amber"), (99, "red"), (500, "red"), ("x", "gray")],
)
def test_band_color(v, color):
    bands = [[50, "green"], [80, "amber"], [100, "red"]]
    assert values.band_color(v, bands, default="gray") == color
