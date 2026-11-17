"""Validação do config (build_config): o exemplo passa, e cada problema vira uma mensagem clara."""

from __future__ import annotations

from pathlib import Path

import pytest

from app import i18n
from app.config import ConfigError, build_config

P = Path("config.yaml")


def problems(raw) -> str:
    with pytest.raises(ConfigError) as e:
        build_config(raw, P)
    return str(e.value)


def test_the_example_config_is_valid(example_raw):
    cfg = build_config(example_raw, P)
    assert cfg.pages
    assert cfg.home in cfg.pages


def test_minimal_config():
    cfg = build_config(
        {"pages": {"main": {1: {"icon": {"text": "a"}, "action": {"type": "hotkey", "keys": "ctrl+c"}}}}}, P
    )
    assert cfg.home == "main"
    assert list(cfg.pages["main"]) == [1]


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ([1], "config.yaml: the file must be an object (key: value)"),
        ({"pages": {}}, "define at least one page in 'pages:'"),
        ({"pages": {"main": {0: {}}}}, "pages.main.0: the key must be from 1 to 15"),
        ({"pages": {"main": {16: {}}}}, "pages.main.16: the key must be from 1 to 15"),
        (
            {"pages": {"main": {1: {"action": {"type": "hotkey"}}}}},
            "pages.main.1.action: action 'hotkey' needs the field 'keys'",
        ),
        ({"pages": {"main": {1: {"action": {"type": "nope"}}}}}, "pages.main.1.action: unknown action type 'nope'"),
        (
            {"pages": {"main": {1: {"action": {"type": "page", "page": "nope"}}}}},
            "pages.main.1: 'page' action points to 'nope', which doesn't exist",
        ),
        ({"home": "nope", "pages": {"main": {}}}, "home: page 'nope' doesn't exist"),
        (
            {"pages": {"main": {5: {"widget": "clock", "size": "1x2"}}}},
            "pages.main.5.span: a 1x2 block doesn't fit starting at this key",
        ),
    ],
)
def test_problem_messages(raw, message):
    assert message in problems(raw)


def test_all_problems_come_together():
    text = problems({"pages": {"main": {1: {"action": {"type": "x"}}, 0: {}}}})
    assert text.startswith("problems in the config:")
    assert "pages.main.1.action: unknown action type 'x'" in text
    assert "pages.main.0: the key must be from 1 to 15" in text


def test_messages_follow_the_language():
    i18n.set_language("pt-BR")
    assert "defina pelo menos uma página em 'pages:'" in problems({"pages": {}})


def test_missing_widget_becomes_a_placeholder_block():
    cfg = build_config({"pages": {"main": {1: {"widget": "nope", "size": "1x2"}}}}, P)
    k = cfg.pages["main"][1]
    assert k.span == (2, 1)
    assert k.icon["sub"] == "unavailable"
    assert cfg.cover["main"] == {2: (1, 1)}  # a tecla 2 é coberta pelo bloco da 1


# Problemas conhecidos (a corrigir na Fase 4, validação por seção): hoje quebram com erro do Python.
@pytest.mark.xfail(raises=AttributeError, strict=True, reason="página que não é um mapa de teclas quebra a validação")
def test_page_that_is_not_a_map():
    assert "pages.main" in problems({"pages": {"main": 5}})


@pytest.mark.xfail(raises=ValueError, strict=True, reason="brightness que não é número escapa da validação")
def test_brightness_that_is_not_a_number():
    assert "brightness" in problems({"brightness": "x", "pages": {"main": {}}})


@pytest.mark.xfail(raises=KeyError, strict=True, reason="toggle sem 'on' quebra a validação (o editor recebe erro 500)")
def test_toggle_without_on():
    assert "needs the field 'on'" in problems({"pages": {"main": {1: {"action": {"type": "toggle"}}}}})
