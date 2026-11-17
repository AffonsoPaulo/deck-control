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


# Antes da Fase 4 (validação por seção), estes quebravam com erro do Python em vez de mensagem.
@pytest.mark.parametrize("keys", [5, [1], "x"])
def test_page_that_is_not_a_map(keys):
    text = problems({"pages": {"main": keys, "other": {1: {"action": "page:main"}}}})
    assert "pages.main: expected an object (key number: key)" in text
    assert "page 'main'" not in text and "points to 'main'" not in text  # a página existe (vazia): nada em cascata


@pytest.mark.parametrize("keys", [None, "", []])
def test_empty_page_is_still_valid(keys):
    assert build_config({"pages": {"main": keys}}, P).pages == {"main": {}}


def test_page_that_is_not_a_map_in_portuguese():
    i18n.set_language("pt-BR")
    assert "pages.main: esperado um objeto (número da tecla: tecla)" in problems({"pages": {"main": 5}})


@pytest.mark.parametrize("value", ["x", None, [1], {"a": 1}, float("inf")])
def test_brightness_that_is_not_a_number(value):
    assert "brightness: a number from 0 to 100" in problems({"brightness": value, "pages": {"main": {}}})


@pytest.mark.parametrize(("value", "brightness"), [(300, 100), (-5, 0), (80, 80), ("80", 80), (80.7, 80), (0, 0)])
def test_brightness_out_of_range_is_clamped(value, brightness):
    """Fora de 0 a 100 não é erro (sempre abriu): fica no limite, como o Deck e a ação 'brightness' já faziam."""
    assert build_config({"brightness": value, "pages": {"main": {}}}, P).brightness == brightness


def test_brightness_defaults_to_100():
    assert build_config({"pages": {"main": {}}}, P).brightness == 100


def test_toggle_without_on():
    assert "pages.main.1.action: action 'toggle' needs the field 'on'" in problems(
        {"pages": {"main": {1: {"action": {"type": "toggle"}}}}}
    )


@pytest.mark.parametrize("moment", ["action", "double", "hold", "release"])
def test_toggle_without_on_in_any_moment(moment):
    text = problems({"pages": {"main": {1: {moment: {"type": "toggle", "off": "page:nope"}}}}})
    assert f"pages.main.1.{moment}: action 'toggle' needs the field 'on'" in text


def test_multi_without_actions():
    assert "pages.main.1.action: action 'multi' needs the field 'actions'" in problems(
        {"pages": {"main": {1: {"action": {"type": "multi"}}}}}
    )


# Achados na revisão de casos de borda (e antes, pelo agente da Fase 4): valor de tipo errado escrito à mão no
# config.yaml derrubava a leitura com um erro cru (AttributeError, TypeError, ValueError) em vez de virar problema
# na lista. O editor nunca grava assim; um config editado à mão pode.
@pytest.mark.parametrize(
    "key",
    [
        {"action": 5},
        {"span": [2, 1], "cells": 5},
        {"action": "media:vol_up", "repeat": "press", "repeat_ms": "x"},
    ],
    ids=["action-numero", "cells-numero", "repeat_ms-texto"],
)
def test_wrong_type_in_a_key_becomes_a_problem(key):
    with pytest.raises(ConfigError):
        build_config({"pages": {"main": {"1": key}}}, Path("config.yaml"))


def test_empty_number_in_a_key_is_the_default():
    """hold_ms: (vazio, null no YAML) é como não ter escrito: vale o padrão."""
    cfg = build_config({"pages": {"main": {"1": {"action": "hotkey:a", "hold": "hotkey:b", "hold_ms": None}}}}, P)
    assert cfg.pages["main"][1].hold_ms == 500
