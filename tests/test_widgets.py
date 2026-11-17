"""Modelos de widget: validação e montagem das teclas (expand)."""

from __future__ import annotations

import pytest

from app import widgets

CLOCK = {
    "label": "Clock",
    "category": "time",
    "options": [
        {"name": "fmt", "kind": "choice", "choices": ["24h", "12h"], "default": "24h"},
        {"name": "big", "kind": "bool", "default": False},
    ],
    "sizes": {
        "1x1": [[{"text": "{clock.hour}:{clock.minute}", "sub": "{opt.fmt}", "big": "{opt.big}"}]],
        "1x2": [[{"text": "{clock.hour}"}, {"text": "{clock.minute}", "id": "$id"}]],
    },
    "action": {"type": "timer.toggle", "id": "$id"},
}


@pytest.mark.parametrize(
    ("size", "rc"),
    [("1x1", (1, 1)), ("2X3", (2, 3)), ("3x5", (3, 5)), ("0x1", None), ("4x1", None), ("1x6", None), ("a", None)],
)
def test_parse_size(size, rc):
    assert widgets.parse_size(size) == rc


def test_check_accepts_a_valid_widget():
    assert widgets.check("clock", CLOCK) is None


@pytest.mark.parametrize(
    ("d", "start"),
    [
        ({}, "the widget 'w' needs 'sizes'"),
        ({"sizes": {"2x1": [[{}]]}}, "the widget 'w' has an invalid size '2x1'"),
        ({"sizes": {"1x1": [[{}]]}, "options": {}}, "the widget 'w': 'options' must be a list"),
        (
            {"sizes": {"1x1": [[{}]]}, "options": [{"name": "a", "kind": "nope"}]},
            "the widget 'w' has an invalid option",
        ),
        ({"sizes": {"1x1": [[{}]]}, "options": [{"name": "a", "kind": "choice"}]}, "the widget 'w': the option 'a'"),
    ],
)
def test_check_messages(d, start):
    assert widgets.check("w", d).startswith(start)


def test_normalize_fills_defaults_and_unknown_category():
    n = widgets.normalize({"sizes": {"1x1": [[{}]]}, "category": "nope"}, plugin="p")
    assert n["label"] == "?"
    assert n["icon"] == "layout-grid"
    assert n["category"] == "other"
    assert n["plugin"] == "p"
    assert "action" not in n


def test_user_defs_drop_invalid_and_mark_as_mine():
    defs = widgets.user_defs({"ok": CLOCK, "bad": {}})
    assert list(defs) == ["ok"]
    assert defs["ok"]["category"] == "mine"
    assert defs["ok"]["mine"] is True


def test_categories_use_theme_variables():
    for c in widgets.categories():
        assert c["color"] == f"var(--cat-{c['hue']})"


def test_builtin_widgets_are_valid():
    for name, d in widgets.builtin().items():
        assert widgets.check(name, d) is None, name


DEFS = {"clock": widgets.normalize(CLOCK)}


def test_expand_fills_options_and_id():
    out = widgets.expand({"widget": "clock", "size": "1x2", "options": {"id": "t 1"}}, DEFS)
    assert out["span"] == (2, 1)  # (colunas, linhas)
    assert out["cells"][1]["id"] == "t_1"  # o id vira algo seguro para nome de contagem
    assert out["action"] == {"type": "timer.toggle", "id": "t_1"}
    assert out["icon"] == {"text": "Clock"}  # bloco de várias teclas: o ícone é só o nome


def test_expand_single_cell_keeps_raw_option_values():
    out = widgets.expand({"widget": "clock", "size": "1x1", "options": {"fmt": "12h", "big": True}}, DEFS)
    cell = out["cells"][0]
    assert cell["sub"] == "12h"
    assert cell["big"] is True  # "{opt.big}" sozinho vira o valor cru, não o texto "True"
    assert out["icon"] == cell


def test_expand_applies_colors():
    out = widgets.expand({"widget": "clock", "size": "1x2", "colors": {"bg": "#123456", "fg": "#ffffff"}}, DEFS)
    assert all(c["bg"] == "#123456" and c["fg"] == "#ffffff" for c in out["cells"])


def test_expand_does_not_change_the_model():
    widgets.expand({"widget": "clock", "size": "1x2", "options": {"id": "a"}}, DEFS)
    assert DEFS["clock"]["sizes"]["1x2"][0][1]["id"] == "$id"


@pytest.mark.parametrize(
    "k",
    [{"widget": "gone", "size": "1x2"}, {"widget": "clock", "size": "3x3"}],
)
def test_expand_missing_widget_becomes_a_placeholder(k):
    out = widgets.expand(k, DEFS)
    rows, cols = widgets.parse_size(k["size"])
    assert out["missing"] is True
    assert len(out["cells"]) == rows * cols
    assert out["cells"][0]["sub"] == "unavailable"


def test_same_ignores_key_order():
    assert widgets.same({"a": 1, "b": [1, 2]}, {"b": [1, 2], "a": 1})
    assert not widgets.same({"a": 1}, {"a": 2})


# ---------------------------------------------------------------------------- variantes e o relógio novo


def test_variant_picks_the_branch_of_the_option():
    d = widgets.normalize(
        {
            "label": "V",
            "options": [
                {"name": "on", "kind": "bool", "default": True},
                {"name": "pick", "kind": "choice", "choices": [], "default": "a"},
            ],
            "sizes": {
                "1x1": [
                    [
                        {
                            "text": "x",
                            "sub": {"$opt": "on", "true": "ligado"},
                            "fg": {"$opt": "pick", "a": "#fff", "b": "#000"},
                        }
                    ]
                ]
            },
        }
    )
    defs = {"v": d}
    cell = widgets.expand({"widget": "v", "size": "1x1"}, defs)["cells"][0]
    assert cell["sub"] == "ligado" and cell["fg"] == "#fff"
    cell = widgets.expand({"widget": "v", "size": "1x1", "options": {"on": False, "pick": "b"}}, defs)["cells"][0]
    assert "sub" not in cell  # sem ramo para false: some
    assert cell["fg"] == "#000"


def test_variant_must_point_to_an_existing_option():
    bad = {"sizes": {"1x1": [[{"text": "x", "sub": {"$opt": "nope", "true": "y"}}]]}, "options": []}
    assert widgets.check("w", bad) == "the widget 'w': '$opt' points to the option 'nope', which doesn't exist"


CLOCK_DEFS = {"app.clock": widgets.normalize(widgets.builtin()["app.clock"])}


def test_clock_has_no_colon_and_labels_by_default():
    cells = widgets.expand({"widget": "app.clock", "size": "1x2"}, CLOCK_DEFS)["cells"]
    assert all("edge" not in c for c in cells)
    assert [c["sub"] for c in cells] == ["hours", "minutes"]
    assert all(c["transition"] == "flip" for c in cells)


def test_clock_options_labels_off_seconds_and_no_animation():
    k = {"widget": "app.clock", "size": "1x3", "options": {"labels": False, "third": "seconds", "animate": False}}
    cells = widgets.expand(k, CLOCK_DEFS)["cells"]
    assert [c["text"] for c in cells] == ["{clock.hour}", "{clock.minute}", "{clock.second}"]
    assert all("sub" not in c and "transition" not in c for c in cells)
    date = widgets.expand({"widget": "app.clock", "size": "1x3"}, CLOCK_DEFS)["cells"][2]
    assert date["text"] == "{clock.weekday_short}"  # a data continua o padrão do 1x3
