"""Preparação comum dos testes.

Roda antes de qualquer import do app:
- a pasta de dados (plugins da pessoa, logs) vira uma pasta temporária, para os testes não lerem nem gravarem
  nada do app de verdade;
- o idioma fica fixo em inglês (o texto do código), para as mensagens não dependerem do Windows de quem roda;
- os plugins carregam pelo app/bootstrap.py, como no app de verdade.
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
from app.bootstrap import services  # noqa: E402

i18n.set_language("en")
services()  # carrega os plugins (OBS, Discord, clima): as ações deles entram na validação do config

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


@pytest.fixture
def make_engine(tmp_path, monkeypatch):
    """Fábrica de Engine de verdade com aparelho falso, relógio falso e nada mexendo no PC (test_engine_*).

    make_engine(yaml) grava o config em tmp_path e devolve um EngineRig (tests/fakes/engine.py), ainda sem
    conectar: rig.connect() conecta e desenha. O relógio falso troca o `time` do engine, dos valores
    (contagens, relógio das teclas) e das automações antes do Engine nascer.
    """
    import textwrap

    from app import actions, automations, engine as engine_mod, keys, values, winutil
    from tests.fakes.clock import FakeClock
    from tests.fakes.deck import FakeDeckFactory
    from tests.fakes.engine import EngineRig, InlineExecutor, StubPlugins, spy_run

    clock = FakeClock()
    for mod in (engine_mod, values, automations):
        monkeypatch.setattr(mod, "time", clock)
    factory = FakeDeckFactory()
    monkeypatch.setattr(engine_mod, "D6", factory)  # nunca abre o HID: o app de verdade pode estar usando o D6

    # teclado do PC: só registra (o engine chama key_down/key_up direto para as combinações seguradas)
    pressed: list[tuple[str, str]] = []
    monkeypatch.setattr(keys, "press_combo", lambda combo, hold_ms=30: pressed.append(("press", str(combo))))
    monkeypatch.setattr(keys, "key_down", lambda combo: pressed.append(("down", str(combo))))
    monkeypatch.setattr(keys, "key_up", lambda combo: pressed.append(("up", str(combo))))
    monkeypatch.setattr(keys, "type_text", lambda text, delay_ms=0: pressed.append(("type", str(text))))
    monkeypatch.setattr(winutil, "screen_off", lambda: False)

    def forbidden(spec, ctx):
        raise AssertionError(f"o teste rodou de verdade a ação {spec.get('type')}")

    for name in ("launch", "command", "http"):
        monkeypatch.setattr(actions.REGISTRY[name], "fn", forbidden)
    ran: list = []
    monkeypatch.setattr(actions, "run", spy_run(ran, clock, actions.run))

    made: list = []

    def make(config: str) -> EngineRig:
        path = tmp_path / "config.yaml"
        path.write_text(textwrap.dedent(config), encoding="utf-8")
        engine = engine_mod.Engine(path, plugins=StubPlugins(), values=values.Values())
        engine._pool.shutdown(wait=True)
        engine._pool = InlineExecutor()  # type: ignore[assignment]
        made.append(engine)
        return EngineRig(engine, clock, factory, ran, pressed)

    yield make
    for engine in made:
        engine.values.engine = None


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_DATA, ignore_errors=True)
