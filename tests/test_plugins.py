"""Plugins: os que vêm com o app carregam, e o manifesto de um plugin externo é validado."""

from __future__ import annotations

import json

import pytest

from app import actions  # noqa: F401  (importar já carrega os plugins; a Fase 1 tira isso do import)
from app.plugins import MANAGER, PluginError, check_manifest, read_manifest

OK = {"id": "meu-plugin", "name": "Meu plugin", "run": ["python", "main.py"]}


def test_builtin_plugins_load_without_errors():
    assert MANAGER.errors == []
    assert {"obs", "discord", "weather"} <= set(MANAGER.plugins)


def test_builtin_plugins_register_their_actions():
    assert "obs.record" in actions.REGISTRY
    assert actions.REGISTRY["obs.record"].plugin == "obs"


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
