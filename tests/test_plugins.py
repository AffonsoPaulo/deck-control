"""Plugins: os que vêm com o app carregam, e o manifesto de um plugin externo é validado."""

from __future__ import annotations

import json

import pytest

from app import actions
from app.plugins import MANAGER, PluginAPI, PluginError, check_manifest, read_manifest

OK = {"id": "meu-plugin", "name": "Meu plugin", "run": ["python", "main.py"]}


def test_builtin_plugins_load_without_errors():
    assert MANAGER.errors == []
    assert {"obs", "discord", "weather"} <= set(MANAGER.plugins)


def test_builtin_plugins_register_their_actions():
    assert "obs.record" in actions.REGISTRY
    assert actions.REGISTRY["obs.record"].plugin == "obs"


def test_plugin_name_is_translated_but_field_names_are_not():
    from app.plugins.manifest import localize

    m = {"id": "x", "name": "%name%", "settings": [{"name": "city", "label": "%city%"}]}
    locales = {"en": {"name": "Weather", "city": "City"}, "pt-BR": {"name": "Clima", "city": "Cidade"}}
    assert localize(m, locales, "en")["name"] == "Weather"
    pt = localize(m, locales, "pt-BR")
    assert (pt["name"], pt["settings"][0]["name"], pt["settings"][0]["label"]) == ("Clima", "city", "Cidade")
    assert MANAGER.plugins["weather"].text("en")["name"] == "Weather"


def test_valid_external_manifest():
    check_manifest(dict(OK), builtin=False)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"id": "X"}, "'id' must have 2 to 40 lowercase letters"),
        ({"name": ""}, "'name' is missing"),
        ({"run": "python main.py"}, "'run' must be the plugin's command line"),
        ({"config_key": "x"}, "'config_key' is only for built-in plugins"),
        ({"actions": []}, "'actions' must be an object"),
        ({"actions": {"other.go": {"label": "Go"}}}, "the action 'other.go' must start with 'meu-plugin.'"),
        ({"actions": {"meu-plugin.go": {}}}, "the action 'meu-plugin.go' needs a 'label'"),
        ({"widgets": {"other.w": {}}}, "the widget 'other.w' must start with 'meu-plugin.'"),
    ],
)
def test_manifest_problems(change, message):
    with pytest.raises(PluginError) as e:
        check_manifest({**OK, **change}, builtin=False)
    assert message in str(e.value)


def test_builtin_plugin_needs_an_entry():
    with pytest.raises(PluginError, match="needs 'entry'"):
        check_manifest({"id": "abc", "name": "Abc"}, builtin=True)


def test_read_manifest_from_a_folder(tmp_path):
    with pytest.raises(PluginError, match="plugin.json is missing"):
        read_manifest(tmp_path, builtin=False)
    (tmp_path / "plugin.json").write_text("{ não é json", encoding="utf-8")
    with pytest.raises(PluginError, match="invalid plugin.json"):
        read_manifest(tmp_path, builtin=False)
    (tmp_path / "plugin.json").write_text(json.dumps(OK), encoding="utf-8")
    assert read_manifest(tmp_path, builtin=False)["id"] == "meu-plugin"


def test_plugin_values_go_to_the_shared_values():
    api = PluginAPI(MANAGER, MANAGER.plugins["obs"])
    api.set_value("obs.test_value", 7)
    assert MANAGER.values.get("obs.test_value") == 7
    api.set_value("other.value", 1)  # fora do prefixo do plugin: ignorado
    assert MANAGER.values.get("other.value") is None
    MANAGER.values.forget_prefix("obs.test_value")


def test_plugin_api_states_log_and_language(monkeypatch, caplog):
    class Engine:
        def __init__(self):
            self.states = {}

        def set_state(self, name, value):
            self.states[name] = value

    p = MANAGER.plugins["obs"]
    api = PluginAPI(MANAGER, p)
    assert api.id == "obs" and api.folder == p.path
    assert api.log.name == "deck.plugins.obs"
    assert api.language() == "en"
    monkeypatch.setattr(MANAGER, "engine", None)
    api.set_state("obs.test", True)  # sem engine (app abrindo): não faz nada
    eng = Engine()
    monkeypatch.setattr(MANAGER, "engine", eng)
    api.set_state("obs.test", 1)
    api.set_state("other.test", True)
    assert eng.states == {"obs.test": True}
    assert "State 'other.test' ignored: it must start with 'obs.'" in caplog.messages


def test_obs_publishes_scene_and_times_through_the_api():
    import sys

    obs_mod = sys.modules["d6plugin_obs"]

    class FakeEngine:
        def states_with_prefix(self, prefix):
            return [f"{prefix}Jogo", f"{prefix}Pausa"]

        def __init__(self):
            self.states = {}

        def set_state(self, name, value):
            self.states[name] = value

    published = {}
    eng = FakeEngine()
    client = obs_mod.OBS(eng, {}, lambda name, value: published.__setitem__(name, value))
    client._set_scene("Jogo")
    client._publish_times()
    assert published["obs.scene"] == "Jogo"
    assert eng.states == {"obs.scene:Jogo": True, "obs.scene:Pausa": False}
    assert published["obs.stream_time"]() == "00:00"  # parado: o valor é calculado na hora


# ---------------------------------------------------------------------------- OBS fechado não é problema


def _obs_plugin():
    import importlib.util

    from app import paths

    spec = importlib.util.spec_from_file_location("obs_plugin_test", paths.BUILTIN_PLUGINS / "obs" / "plugin.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_obs_closed_on_this_pc_is_not_a_problem():
    """Fora da live o OBS fica fechado: a conexão recusada não abre problema (sem selo na bandeja)."""
    obs = _obs_plugin()
    refused = ConnectionRefusedError(10061, "refused")
    assert obs.classify(refused, "localhost", lambda: False) is None
    assert obs.classify(refused, "127.0.0.1", lambda: False) is None


def test_obs_open_but_refusing_says_the_websocket_server_is_off():
    obs = _obs_plugin()
    text, reason = obs.classify(ConnectionRefusedError(10061, "refused"), "localhost", lambda: True)
    assert "WebSocket server is off" in text and "Tools" in text


def test_obs_on_another_pc_keeps_the_old_warning_and_does_not_read_processes():
    obs = _obs_plugin()

    def never():
        raise AssertionError("não lê a lista de processos para um OBS em outro computador")

    text, _ = obs.classify(ConnectionRefusedError(10061, "refused"), "192.168.0.20", never, local=lambda h: False)
    assert "OBS is closed or its WebSocket server is off" in text


def test_obs_wrong_password_is_still_a_problem_even_if_closed_check_says_no():
    obs = _obs_plugin()
    text, reason = obs.classify(Exception("authentication failed"), "localhost", lambda: False)
    assert reason == "wrong password"


def test_process_running_finds_this_python_and_not_a_made_up_name():
    import os
    import sys

    from app.windows import winutil

    assert winutil.process_running(os.path.basename(sys.executable))
    assert not winutil.process_running("nao-existe-deck-123.exe")


def test_obs_at_this_pcs_own_network_address_counts_as_this_pc():
    """O config pode apontar para o 192.168.x.y do próprio PC: conta como local (OBS fechado não é problema)."""
    import socket

    obs = _obs_plugin()
    assert obs.is_this_pc("localhost") and obs.is_this_pc("127.0.0.1")
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sk:
        sk.connect(("192.0.2.1", 9))  # não manda nada: só descobre o endereço desta máquina na rede
        mine = sk.getsockname()[0]
    if not mine.startswith("0."):
        assert obs.is_this_pc(mine)
    assert not obs.is_this_pc("192.0.2.123")  # endereço de documentação, nunca desta máquina
    assert not obs.is_this_pc("nao-existe.invalid")
