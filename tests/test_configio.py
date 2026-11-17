"""Gravação do config pelo editor: só o que mudou, sem perder comentários nem a ordem."""

from __future__ import annotations

import copy

import pytest

from app import configio

TEXT = """\
# Config de teste
brightness: 80

pages:
  # primeira página
  main:
    1: { text: "Oi", action: { type: hotkey, keys: "ctrl+c" } }
    2: { text: "Tchau" }

  # página do OBS
  obs:
    1: { text: "Gravar" }

  extra:
    3: { text: "Três" }

# luz do anel
lighting:
  effect: static
"""


@pytest.fixture
def cfg_file(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text(TEXT, encoding="utf-8")
    return p


def test_read_plain_turns_nodes_into_plain_types(cfg_file):
    cfg = configio.read_plain(cfg_file)
    assert type(cfg) is dict
    assert type(cfg["pages"]["main"]) is dict
    # as teclas saem como texto ("1"), igual ao JSON que o navegador manda de volta
    assert cfg["pages"]["main"]["1"]["text"] == "Oi"


def test_saving_the_same_content_does_not_touch_the_file(cfg_file):
    cfg = configio.read_plain(cfg_file)
    configio.save_plain(cfg_file, cfg)
    assert cfg_file.read_text(encoding="utf-8") == TEXT
    assert not cfg_file.with_suffix(".yaml.bak").exists()


def test_changing_one_value_keeps_comments_and_the_rest(cfg_file):
    cfg = configio.read_plain(cfg_file)
    cfg["brightness"] = 50
    configio.save_plain(cfg_file, cfg)
    text = cfg_file.read_text(encoding="utf-8")
    assert "brightness: 50" in text
    assert text.replace("brightness: 50", "brightness: 80") == TEXT
    assert cfg_file.with_suffix(".yaml.bak").read_text(encoding="utf-8") == TEXT


def test_new_key_from_the_browser_is_saved_as_a_number_in_order(cfg_file):
    cfg = configio.read_plain(cfg_file)
    cfg["pages"]["main"]["5"] = {"text": "Cinco"}
    cfg["pages"]["main"] = {"5": cfg["pages"]["main"]["5"], **cfg["pages"]["main"]}  # chega fora de ordem
    configio.save_plain(cfg_file, cfg)
    text = cfg_file.read_text(encoding="utf-8")
    assert "    5: { text: Cinco }" in text  # texto novo só ganha aspas quando precisa
    assert text.index("    2:") < text.index("    5:") < text.index("  # página do OBS")
    assert list(configio.read_plain(cfg_file)["pages"]["main"]) == ["1", "2", "5"]


@pytest.mark.parametrize("name", ["main", "obs", "extra"])
def test_delete_and_undo_brings_the_page_back_to_its_place(cfg_file, name):
    cfg = configio.read_plain(cfg_file)
    without = copy.deepcopy(cfg)
    del without["pages"][name]
    configio.save_plain(cfg_file, without)
    configio.save_plain(cfg_file, cfg)  # desfazer: o editor manda a ordem de antes
    again = configio.read_plain(cfg_file)
    assert list(again["pages"]) == ["main", "obs", "extra"]
    assert again == cfg


def test_restored_page_keeps_the_next_section_comment_in_place(cfg_file):
    cfg = configio.read_plain(cfg_file)
    without = copy.deepcopy(cfg)
    del without["pages"]["obs"]
    configio.save_plain(cfg_file, without)
    configio.save_plain(cfg_file, cfg)
    text = cfg_file.read_text(encoding="utf-8")
    assert text.index("obs:") < text.index("extra:")
    # o comentário da luz continua logo antes da seção dela
    assert text.index("# luz do anel") < text.index("lighting:")
    assert text.index("extra:") < text.index("# luz do anel")


def test_without_secrets_blanks_the_obs_password():
    text = 'obs:\n  host: localhost\n  password: "segredo-de-teste"\n'
    out = configio.without_secrets(text)
    assert "segredo-de-teste" not in out
    assert "host: localhost" in out
