"""O config em disco pelo repositório (app/storage.py): ler, validar, gravar com .bak e o histórico."""

from __future__ import annotations

import pytest

from app.config import ConfigError
from app.storage import ConfigRepository

TEXT = """\
# comentário que tem de ficar
language: en
brightness: 70
pages:
  main:
    1: { icon: { text: "A" }, action: { type: hotkey, keys: "ctrl+c" } }
obs:
  password: "segredo"
"""


@pytest.fixture
def store(tmp_path) -> ConfigRepository:
    p = tmp_path / "config.yaml"
    p.write_text(TEXT, encoding="utf-8")
    return ConfigRepository(p)


def test_create_from_the_example_only_when_missing(tmp_path, store):
    example = tmp_path / "example.yaml"
    example.write_text("pages: {main: {}}\n", encoding="utf-8")
    assert store.create_from(example) is False
    assert store.read_text() == TEXT
    new = ConfigRepository(tmp_path / "novo.yaml")
    assert new.create_from(example) is True
    assert new.read_text() == "pages: {main: {}}\n"


def test_reads_and_validates(store):
    assert store.read_raw()["brightness"] == 70
    assert list(store.read_plain()["pages"]["main"]) == ["1"]  # para o editor (JSON): as teclas viram texto
    assert store.load().pages["main"][1].action == {"type": "hotkey", "keys": "ctrl+c"}
    with pytest.raises(ConfigError, match="define at least one page"):
        store.validate({"pages": {}})


def test_text_without_secrets(store):
    text = store.text_without_secrets([("obs", "password")])
    assert "segredo" not in text and "# comentário que tem de ficar" in text
    assert "segredo" in store.read_text()  # o arquivo não muda


def test_save_keeps_comments_and_a_backup(store):
    cfg = store.read_plain()
    cfg["brightness"] = 40
    store.save(cfg)
    assert store.read_raw()["brightness"] == 40
    assert "# comentário que tem de ficar" in store.read_text()
    bak = store.path.with_suffix(".yaml.bak")
    assert bak.read_text(encoding="utf-8") == TEXT
    assert not store.path.with_suffix(".yaml.tmp").exists()


def test_history_record_and_restore(store):
    store.record()
    cfg = store.read_plain()
    cfg["brightness"] = 10
    store.save(cfg)
    store.record(reason="teste")
    versions = store.versions()
    assert len(versions) == 2 and versions[0]["reason"] == "teste"
    store.restore(versions[-1]["id"])
    assert store.read_text() == TEXT
    assert store.path.with_suffix(".yaml.bak").read_text(encoding="utf-8") != TEXT  # o de antes de voltar
    assert len(store.versions()) == 3  # voltar também vira uma versão
