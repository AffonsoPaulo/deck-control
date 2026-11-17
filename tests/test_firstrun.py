"""Primeira abertura do executável (Fase 7): o config.yaml antigo é copiado para %APPDATA%\\Deck, nunca movido."""

from __future__ import annotations

import logging

import pytest

from app import firstrun, history, paths

TEXT = """\
# o config de antes
pages:
  main:
    1: { icon: { image: "icons/a.png" }, action: { type: hotkey, keys: "ctrl+c" } }
    2: { icon: { image: "fotos/b.png" }, active_icon: { image: "fotos/b2.png" } }
    3: { icon: { image: "../fora.png" } }
"""


@pytest.fixture
def deck(tmp_path, monkeypatch):
    """A pasta do Deck.exe com um config antigo (e imagens), e as pastas da pessoa em tmp_path."""
    monkeypatch.setenv("APPDATA", str(tmp_path / "roaming"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    folder = tmp_path / "Deck"
    (folder / "icons").mkdir(parents=True)
    (folder / "fotos").mkdir()
    (folder / "config.yaml").write_text(TEXT, encoding="utf-8")
    for rel in ("icons/a.png", "icons/sem-uso.png", "fotos/b.png", "fotos/b2.png", "fotos/outra.png"):
        (folder / rel).write_bytes(rel.encode())
    (tmp_path / "fora.png").write_bytes(b"x")
    return folder


def _copy(deck, **kw):
    return firstrun.copy_old_config(
        paths.default_config(frozen=True), frozen=True, executable=str(deck / "Deck.exe"), **kw
    )


def test_copies_the_old_config_and_its_images(deck, tmp_path):
    copied = _copy(deck)
    new = tmp_path / "roaming" / "Deck" / "config.yaml"
    assert copied == firstrun.Copied(deck / "config.yaml", new, 4, False)
    assert new.read_text(encoding="utf-8") == TEXT
    assert (deck / "config.yaml").read_text(encoding="utf-8") == TEXT  # o antigo fica onde estava
    for rel in ("icons/a.png", "icons/sem-uso.png", "fotos/b.png", "fotos/b2.png"):
        assert (new.parent / rel).read_bytes() == rel.encode()
    assert not (new.parent / "fotos" / "outra.png").exists()  # fora de icons/ e sem tecla usando
    assert not (tmp_path / "roaming" / "fora.png").exists()  # ../ não sai da pasta
    assert not new.with_name("config.yaml.tmp").exists()


def test_only_on_the_first_start(deck):
    assert _copy(deck) is not None
    (deck / "config.yaml").write_text("pages: {main: {}}\n", encoding="utf-8")
    assert _copy(deck) is None  # o novo já existe: não é copiado de novo nem trocado
    assert paths.default_config(frozen=True).read_text(encoding="utf-8") == TEXT


def test_brings_the_history_of_the_old_config(deck, tmp_path):
    from app.storage import ConfigRepository

    ConfigRepository(deck / "config.yaml").record()  # em desenvolvimento: %LOCALAPPDATA%\D6Deck\history
    copied = _copy(deck)
    assert copied is not None and copied.history
    folder = tmp_path / "roaming" / "Deck" / "history" / history.key(copied.new)  # onde o executável lê
    assert len(list(folder.glob("*.json"))) == 1


@pytest.mark.parametrize("frozen", [False, True])
def test_nothing_to_do(deck, tmp_path, frozen):
    if frozen:  # executável sem config antigo ao lado
        (deck / "config.yaml").unlink()
        assert _copy(deck) is None
    else:  # desenvolvimento: o config continua na pasta do projeto
        assert firstrun.copy_old_config(paths.ROOT / "config.yaml", frozen=False) is None
    assert not (tmp_path / "roaming" / "Deck" / "config.yaml").exists()


def test_a_chosen_config_is_left_alone(deck, tmp_path):
    other = tmp_path / "outro" / "config.yaml"
    assert firstrun.copy_old_config(other, frozen=True, executable=str(deck / "Deck.exe")) is None
    assert not other.exists()


def test_a_broken_config_is_copied_as_it_is(deck):
    (deck / "config.yaml").write_text("pages: [\n", encoding="utf-8")  # o erro aparece ao carregar
    copied = _copy(deck)
    assert copied is not None and copied.images == 2  # só a pasta icons/
    assert copied.new.read_text(encoding="utf-8") == "pages: [\n"


def test_warns_on_the_terminal_and_in_the_log(tmp_path, monkeypatch, capsys, caplog):
    import app.__main__ as main

    copied = firstrun.Copied(tmp_path / "old.yaml", tmp_path / "new.yaml", 2, True)
    monkeypatch.setattr(firstrun, "copy_old_config", lambda config: copied)
    with caplog.at_level(logging.WARNING, logger="deck.app"):
        main._copy_old_config(tmp_path / "new.yaml", False, logging.getLogger("deck.app"))
    assert "Your settings were copied from" in capsys.readouterr().out
    assert "copied the old config" in caplog.text


def test_does_nothing_in_development(tmp_path, capsys):
    import app.__main__ as main

    assert not paths.FROZEN
    main._copy_old_config(tmp_path / "config.yaml", False, logging.getLogger("deck.app"))
    assert capsys.readouterr().out == ""
