"""Protocolo dos plugins de terceiros (versão 1), com um processo de verdade: tests/fakes/probe_plugin.py.

O plugin de sonda roda numa pasta temporária. Grava como foi aberto (facts.json) e o que recebeu
(received.jsonl); o que ele faz numa ação vem do parâmetro "do".
"""

from __future__ import annotations

import json
import logging
import shutil
import sys
import time
import types
from pathlib import Path

import pytest

from app import actions, logs, paths
from app.plugins import MANAGER, Plugin, external
from app.plugins.external import ExternalPlugin

PROBE = Path(__file__).parent / "fakes" / "probe_plugin.py"
MANIFEST = {
    "id": "probe",
    "name": "Probe",
    "version": "0.1",
    "run": ["python", "main.py"],
    "actions": {"probe.go": {"label": "Go"}},
}


def wait_until(cond, timeout: float = 10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = cond()
        if value:
            return value
        time.sleep(0.02)
    raise AssertionError("o plugin não chegou lá a tempo")


class FakeEngine:
    def __init__(self) -> None:
        self.states: dict[str, bool] = {}

    def set_state(self, name: str, value: bool) -> None:
        self.states[name] = value


class Probe:
    def __init__(self, folder: Path, ext: ExternalPlugin, engine: FakeEngine) -> None:
        self.folder, self.ext, self.engine = folder, ext, engine

    def received(self) -> list[dict]:
        f = self.folder / "received.jsonl"
        return [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines()] if f.exists() else []

    def facts(self) -> dict:
        return json.loads(wait_until(lambda: (self.folder / "facts.json").exists() and self._read_facts()))

    def _read_facts(self) -> str | None:
        text = (self.folder / "facts.json").read_text(encoding="utf-8")
        return text if text.endswith("}") else None

    def act(self, **params):
        ctx = actions.Context(engine=self.engine, page="main", key=3)  # type: ignore[arg-type]
        return self.ext.make_action("probe.go")({"type": "probe.go", **params}, ctx)


def make_probe(tmp_path: Path, monkeypatch, **manifest) -> Probe:
    folder = tmp_path / "probe"
    folder.mkdir(parents=True)
    shutil.copy(PROBE, folder / "main.py")
    m = {**MANIFEST, **manifest}
    (folder / "plugin.json").write_text(json.dumps(m), encoding="utf-8")
    engine = FakeEngine()
    monkeypatch.setattr(MANAGER, "engine", engine)
    p = Plugin("probe", folder, m, builtin=False)
    return Probe(folder, ExternalPlugin(MANAGER, p), engine)


@pytest.fixture
def probe(tmp_path, monkeypatch):
    pr = make_probe(tmp_path, monkeypatch)
    yield pr
    pr.ext.stop()
    MANAGER.values.forget_prefix("probe.")
    logs.resolve_prefix("plugin.probe.")


def test_hello_and_how_the_program_is_opened(probe, caplog):
    caplog.set_level(logging.DEBUG, logger="deck.plugins.probe")
    probe.ext.start({"focus": 25, "token": "s3cret"})
    wait_until(lambda: probe.received())
    assert probe.received()[0] == {
        "type": "hello",
        "protocol": 1,
        "plugin": "probe",
        "locale": "en",
        "settings": {"focus": 25, "token": "s3cret"},
    }
    wait_until(lambda: probe.ext.current_status()["label"] == "Ready ✓")  # UTF-8 nos dois sentidos
    assert probe.ext.current_status() == {"state": "ok", "label": "Ready ✓"}
    facts = probe.facts()
    assert Path(facts["cwd"]) == probe.folder
    assert facts["plugin_id"] == "probe"
    assert facts["unbuffered"] == "1"
    assert facts["stdout_encoding"].lower().replace("-", "") == "utf8"
    assert facts["name"] == "__main__"
    assert facts["app_loaded"] == []  # o plugin não enxerga os módulos do app
    wait_until(lambda: "stderr: probe: hello on stderr" in caplog.messages)
    assert all("s3cret" not in m for m in caplog.messages)  # o hello leva as senhas: não vai para o log


def test_settings_and_locale_only_go_when_they_change(probe):
    probe.ext.start({"focus": 25})
    probe.ext.update({"focus": 25})
    probe.ext.update({"focus": 30})
    probe.ext.set_locale("en")
    probe.ext.set_locale("pt-BR")
    probe.act(do="ok")  # a resposta da ação garante que as mensagens de antes já chegaram
    kinds = [m["type"] for m in probe.received()]
    assert kinds == ["hello", "settings", "locale", "action"]
    assert probe.received()[1] == {"type": "settings", "settings": {"focus": 30}}
    assert probe.received()[2] == {"type": "locale", "locale": "pt-BR"}


def test_action_ok_error_and_timeout(probe, monkeypatch):
    probe.ext.start({})
    probe.act(do="ok", n=1)
    action = probe.received()[-1]
    assert action == {
        "type": "action",
        "id": 1,
        "action": "probe.go",
        "params": {"do": "ok", "n": 1},
        "page": "main",
        "key": 3,
    }
    with pytest.raises(RuntimeError, match="^boom$"):
        probe.act(do="fail")
    monkeypatch.setattr(external, "ACTION_TIMEOUT", 0.3)
    with pytest.raises(RuntimeError, match="the plugin didn't answer within 0 s"):
        probe.act(do="silent")
    probe.act(do="ok")  # o plugin continua de pé depois de uma ação sem resposta
    assert [m["id"] for m in probe.received() if m["type"] == "action"] == [1, 2, 3, 4]


def test_messages_from_the_plugin(probe, caplog):
    caplog.set_level(logging.DEBUG, logger="deck.plugins.probe")
    probe.ext.start({})
    probe.act(do="publish")
    assert probe.engine.states == {"probe.on": True}  # fora do prefixo do plugin: ignorado
    assert MANAGER.values.get("probe.temp") == 28
    assert MANAGER.values.get("other.temp") is None
    assert probe.ext.current_status() == {"state": "ok", "label": "x" * 40}  # estado desconhecido vira ok
    assert "State 'other.on' ignored: it must start with 'probe.'" in caplog.messages
    assert "Value 'other.temp' ignored: it must start with 'probe.'" in caplog.messages
    rec = {r.getMessage(): r.levelno for r in caplog.records}
    assert rec["from the plugin"] == logging.ERROR
    assert rec["plain text line"] == logging.INFO  # texto que não é JSON vai para o log


def test_action_when_the_plugin_is_not_running(probe):
    with pytest.raises(RuntimeError, match="the plugin isn't running"):
        probe.act(do="ok")


def test_stop_asks_first_and_then_kills(tmp_path, monkeypatch, caplog):
    pr = make_probe(tmp_path, monkeypatch)
    pr.ext.start({"ignore_stop": True})
    pr.act(do="ok")
    proc = pr.ext.proc
    t0 = time.monotonic()
    pr.ext.stop()
    assert 1.5 < time.monotonic() - t0 < 10
    assert proc is not None
    wait_until(lambda: proc.poll() is not None)  # o kill() não espera o processo acabar
    assert pr.ext.proc is None
    assert pr.received()[-1] == {"type": "stop"}
    assert "Plugin didn't close within 2 s; killed it" in caplog.messages


def test_a_crash_fails_the_action_and_restarts_the_plugin(probe, monkeypatch):
    monkeypatch.setattr(external, "time", types.SimpleNamespace(monotonic=time.monotonic, sleep=lambda s: None))
    probe.ext.start({})
    first = probe.ext.proc
    with pytest.raises(RuntimeError, match="the plugin stopped"):
        probe.act(do="crash")
    wait_until(lambda: probe.ext.proc is not None and probe.ext.proc is not first)
    assert any(p["id"] == "plugin.probe.crash" for p in logs.problems())
    wait_until(lambda: [m["type"] for m in probe.received()].count("hello") == 2)
    probe.act(do="ok")  # o novo processo responde
    wait_until(lambda: all(p["id"] != "plugin.probe.crash" for p in logs.problems()))  # mandou mensagem: resolvido


def test_too_many_crashes_and_it_gives_up(probe, monkeypatch):
    monkeypatch.setattr(external, "time", types.SimpleNamespace(monotonic=time.monotonic, sleep=lambda s: None))
    probe.ext.start({"crash_on_hello": True})
    wait_until(lambda: probe.ext.current_status()["label"] == "Stopped")
    assert probe.ext.current_status() == {"state": "error", "label": "Stopped"}
    assert probe.ext.proc is None
    assert probe.ext.p.error == "the plugin stopped several times in a row; see the log"
    assert [m["type"] for m in probe.received()].count("hello") == 1 + external.MAX_RESTARTS
    texts = [p["text"] for p in logs.problems() if p["id"] == "plugin.probe.crash"]
    assert texts == ["The plugin Probe stopped several times in a row and won't be restarted"]


def test_a_program_that_does_not_open(tmp_path, monkeypatch):
    pr = make_probe(tmp_path, monkeypatch, run=["deck-test-no-such-program-xyz"])
    with pytest.raises(RuntimeError, match="couldn't open the plugin"):
        pr.ext.start({})
    assert pr.ext.current_status() == {"state": "error", "label": "Didn't open"}


def test_a_program_the_plugin_brings(tmp_path, monkeypatch):
    """runtime "exe" com um programa da pasta do plugin (aqui um .cmd que chama a sonda). Sem o runtime escrito, o
    mesmo run não abre: o Windows não procura o programa na pasta de trabalho do processo novo (como antes)."""
    python = sys.executable.replace("pythonw.exe", "python.exe")
    for runtime in ("exe", None):
        pr = make_probe(tmp_path / str(runtime), monkeypatch, run=["deck-probe.cmd"])
        (pr.folder / "deck-probe.cmd").write_text(f'@"{python}" "%~dp0main.py" %*\r\n', encoding="utf-8")
        if runtime:
            pr.ext.p.manifest["runtime"] = runtime
            try:
                pr.ext.start({})
                wait_until(lambda pr=pr: pr.ext.current_status()["label"] == "Ready ✓")
                pr.act(do="ok")
            finally:
                pr.ext.stop()
        else:
            with pytest.raises(RuntimeError, match="couldn't open the plugin"):
                pr.ext.start({})


def test_python_runs_with_the_apps_python(probe):
    # antes da Fase 6: [python do app, "main.py"]; agora pelo --run-plugin do app (tests/test_plugins_runtime.py
    # confere que o plugin vê o mesmo que via antes)
    python = sys.executable.replace("pythonw.exe", "python.exe")
    assert probe.ext._command() == [python, str(paths.MAIN_SCRIPT), "--run-plugin", str(probe.folder)]
    probe.ext.p.manifest = {**MANIFEST, "run": ["node", "main.js"]}
    assert probe.ext._command() == ["node", "main.js"]


EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "plugins" / "pomodoro"


def test_the_example_installs_and_starts_after_reload(monkeypatch, caplog):
    """O exemplo do repositório, sem mudar nada: instalar religa o que o config liga (o engine está rodando)."""
    caplog.set_level(logging.INFO, logger="deck.plugins")
    engine = FakeEngine()
    monkeypatch.setattr(MANAGER, "engine", engine)
    monkeypatch.setattr(MANAGER, "_cfg", {"discord": {"enabled": False}, "plugins": {"pomodoro": {"enabled": True}}})
    p = MANAGER.install(EXAMPLE)
    try:
        assert p.running and p.builtin is False
        # Fase 6: o log registra de onde veio e o que roda
        assert (
            "Plugin installed: pomodoro 1.0.0 by Deck example (homepage: none); "
            "runtime deck-python, runs ['python', 'main.py']"
        ) in caplog.messages
        wait_until(lambda: MANAGER.status()["pomodoro"]["label"] == "Ready")
        wait_until(lambda: engine.states.get("pomodoro.running") is False)
        ctx = actions.Context(engine=engine, page="main", key=0)  # type: ignore[arg-type]
        actions.REGISTRY["pomodoro.toggle"].fn({"type": "pomodoro.toggle"}, ctx)
        wait_until(lambda: engine.states.get("pomodoro.running") is True)
    finally:
        MANAGER.remove("pomodoro")
    assert "pomodoro" not in MANAGER.plugins
    assert "pomodoro.toggle" not in actions.REGISTRY
