"""Atalhos (binds): forma canônica, regras de cada programa, conflitos e próximos livres."""

from __future__ import annotations

import pytest

from app import actions  # noqa: F401  (carrega os plugins: usages() lê os atalhos deles)
from app import binds


@pytest.mark.parametrize(
    ("combo", "out"),
    [
        ("Shift+Ctrl+F13", "ctrl+shift+f13"),
        ("alt + ctrl + f14", "ctrl+alt+f14"),
        ("lctrl+f15", "ctrl+f15"),
        ("F16", "f16"),
        ("win+shift+a", "shift+win+a"),
    ],
)
def test_canonical(combo, out):
    assert binds.canonical(combo) == out


def test_default_rules_cover_f13_to_f24_with_every_modifier():
    combos = binds.combos_for(None)
    assert combos == binds.ALL_COMBOS
    assert len(combos) == 12 * len(binds.MOD_ORDER)
    assert combos[0] == "ctrl+shift+alt+f13"
    assert combos[-1] == "f24"


def test_custom_rules():
    rules = {"keys": ["f13", "f20-f21"], "modifiers": ["ctrl", ""]}
    assert binds.combos_for(rules) == ["ctrl+f13", "ctrl+f20", "ctrl+f21", "f13", "f20", "f21"]
    assert binds.allowed("Ctrl+F20", rules)
    assert not binds.allowed("shift+f20", rules)


def _page(*combos):
    return {"pages": {"main": {i + 1: {"action": {"type": "bind", "keys": c}} for i, c in enumerate(combos)}}}


def test_conflicts_between_two_keys():
    raw = _page("ctrl+f13", "Ctrl+F13", "f14")
    found = [c for c in binds.conflicts(raw) if c["combo"] == "ctrl+f13"]
    assert len(found) == 1
    assert [(p["page"], p["key"]) for p in found[0]["places"]] == [("main", "1"), ("main", "2")]


def test_free_combos_skip_what_is_taken():
    rules = {"keys": "f13-f14", "modifiers": [""]}
    assert binds.free_combos(_page("f13"), 1, rules) == ["f14"]
    assert binds.free_combos({"pages": {}}, 1, rules, taken=["F13"]) == ["f14"]  # já escolhidas também contam


def test_plugin_default_shortcuts_count_as_used():
    # o Discord reserva os dele mesmo sem estar no config
    assert "ctrl+shift+alt+f23" in binds.combos_in_config({"pages": {}})


def test_free_combos_raise_when_none_left():
    rules = {"keys": "f13", "modifiers": [""]}
    with pytest.raises(ValueError, match="no free shortcuts left"):
        binds.free_combos(_page("f13"), 1, rules)
