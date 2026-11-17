"""Preparação comum dos testes.

Roda antes de qualquer import do app:
- a pasta de dados (plugins da pessoa, logs) vira uma pasta temporária, para os testes não lerem nem gravarem
  nada do app de verdade;
- o idioma fica fixo em inglês (o texto do código), para as mensagens não dependerem do Windows de quem roda.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

_DATA = tempfile.mkdtemp(prefix="deck-tests-")
os.environ["LOCALAPPDATA"] = _DATA

from app import i18n  # noqa: E402

i18n.set_language("en")

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / "config.example.yaml"


@pytest.fixture(autouse=True)
def _english():
    i18n.set_language("en")
    yield
    i18n.set_language("en")


@pytest.fixture
def example_raw() -> dict:
    """O config.example.yaml lido como dict (o mesmo formato que o editor manda)."""
    import yaml

    return yaml.safe_load(EXAMPLE.read_text(encoding="utf-8"))


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_DATA, ignore_errors=True)
