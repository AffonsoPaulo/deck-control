"""Ciclo de vida dos plugins no gerenciador: ligar, atualizar, desligar, falhar, status e a guarda das ações.

Usa o MANAGER de verdade (o registro de ações e o run_guard são globais), com a lista de plugins trocada só
durante o teste por um plugin falso, que roda dentro do app e anota cada chamada.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

from app import actions, logs
from app.plugins import MANAGER, Plugin, run_guard

MANIFEST = {
    "id": "fake",
    "name": "Fake",
    "version": "1.0",
    "entry": "plugin.py",
    "config_key": "fake",
    "settings": [{"name": "city", "default": "Recife"}, {"name": "token", "kind": "password"}],
}


class Instance:
    """O objeto que o setup(api) de um embutido devolve, anotando as chamadas."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.fail_start: Exception | None = None
        self.status: dict | Exception | None = None

    def start(self, settings: dict) -> None:
        self.calls.append(("start", settings))
        if self.fail_start:
            raise self.fail_start

    def update(self, settings: dict) -> None:
        self.calls.append(("update", settings))

    def set_locale(self, lang: str) -> None:
        self.calls.append(("locale", lang))

    def stop(self) -> None:
        self.calls.append(("stop",))

    def current_status(self) -> dict:
        if isinstance(self.status, Exception):
            raise self.status
        return self.status or {"state": "ok", "label": "Fine"}


class Bare:
    """Instância sem nenhum método (o app só chama o que existe)."""


@pytest.fixture
def plugin(monkeypatch):
    """Um plugin embutido falso como o único do MANAGER (o resto volta no fim do teste)."""
    p = Plugin("fake", Path("."), dict(MANIFEST), builtin=True)
    p.instance = Instance()
    monkeypatch.setattr(MANAGER, "plugins", {"fake": p})
    monkeypatch.setattr(MANAGER, "_cfg", {})
    monkeypatch.setattr(MANAGER, "engine", None)
    yield p
    MANAGER.values.forget_prefix("fake.")
    logs.resolve_prefix("plugin.fake.")


ON = {"fake": {"enabled": True, "city": "Natal"}}


def test_off_until_the_config_turns_it_on(plugin):
    MANAGER.sync({})  # sem seção no config: vale o default_enabled (falso)
    assert plugin.instance.calls == []
    assert plugin.running is False
    assert plugin.status == {"state": "off", "label": "Off"}
    plugin.manifest["default_enabled"] = True
    MANAGER.sync({})
    assert plugin.instance.calls == [("start", {"city": "Recife"})]


def test_where_the_settings_live():
    builtin = Plugin("fake", Path("."), dict(MANIFEST), builtin=True)
    third = Plugin("fake", Path("."), dict(MANIFEST), builtin=False)
    assert builtin.config_path == ["fake"]
    assert third.config_path == ["plugins", "fake"]  # config_key é só dos embutidos
    assert third.settings_from({"plugins": {"fake": {"a": 1}}}) == {"a": 1}
    assert third.settings_from({"plugins": "x"}) is None
    assert builtin.enabled_in({"fake": {}}) is True  # a seção existe e não diz "enabled: false"
    assert builtin.enabled_in({"fake": {"enabled": False}}) is False
    assert builtin.enabled_in({"fake": {"enabled": 0}}) is True  # só o False desliga
    assert builtin.effective_settings({"fake": {"enabled": True, "token": "x"}}) == {"city": "Recife", "token": "x"}


def test_start_update_and_stop(plugin, caplog):
    caplog.set_level(logging.INFO, logger="deck.plugins")
    MANAGER.sync(ON)
    assert plugin.instance.calls == [("start", {"city": "Natal"})]
    assert plugin.running is True and plugin.error is None
    assert plugin.status == {"state": "ok", "label": "On"}
    assert "Plugin started: fake 1.0 (built-in)" in caplog.messages
    assert MANAGER.is_running("fake") and MANAGER.instance("fake") is plugin.instance

    MANAGER.sync({"fake": {"city": "Natal"}})  # ligado de novo: atualiza e repassa o idioma
    assert plugin.instance.calls[1:] == [("update", {"city": "Natal"}), ("locale", "en")]

    MANAGER.values.set("fake.temp", 30)
    logs.problem("plugin.fake.connect", "Fake can't connect")
    MANAGER.sync({"fake": {"enabled": False}})
    assert plugin.instance.calls[-1] == ("stop",)
    assert plugin.running is False
    assert plugin.status == {"state": "off", "label": "Off"}
    assert MANAGER.values.get("fake.temp") is None  # desligado: os valores dele somem
    assert all(not p["id"].startswith("plugin.fake.") for p in logs.problems())
    assert "Plugin stopped: fake" in caplog.messages
    assert MANAGER.instance("fake") is None


def test_a_status_set_before_start_is_kept(plugin):
    plugin.status = {"state": "wait", "label": "Connecting"}  # o plugin chamou api.set_status no start
    MANAGER.sync(ON)
    assert plugin.status == {"state": "wait", "label": "Connecting"}


def test_start_failure_marks_the_plugin_and_retries_on_the_next_sync(plugin, caplog):
    plugin.instance.fail_start = RuntimeError("no network")
    MANAGER.sync(ON)
    assert plugin.running is False
    assert plugin.error == "no network"
    assert plugin.status == {"state": "error", "label": "Didn't start"}
    assert any("Plugin fake didn't start: no network" in m for m in caplog.messages)
    plugin.instance.fail_start = None
    MANAGER.sync(ON)
    assert plugin.running is True and plugin.error is None
    assert plugin.status == {"state": "error", "label": "Didn't start"}  # o "On" só entra saindo de "off"


class FailsOnce:
    """Só start(), sem current_status(): o status que o editor vê é o guardado pelo gerenciador."""

    def __init__(self) -> None:
        self.tries = 0

    def start(self, settings: dict) -> None:
        self.tries += 1
        if self.tries == 1:
            raise RuntimeError("no network")


@pytest.mark.xfail(
    strict=True,
    reason="bug: ligou na segunda tentativa, mas o status continua 'Didn't start' (o 'On' só entra saindo de "
    "'off'); hoje só aparece num plugin sem current_status(), e os embutidos e os externos têm",
)
def test_status_after_a_successful_retry(plugin):
    plugin.instance = FailsOnce()
    MANAGER.sync(ON)
    MANAGER.sync(ON)
    assert plugin.running is True
    assert MANAGER.status()["fake"] == {"state": "ok", "label": "On", "error": None}


def test_stop_failure_is_logged_and_the_plugin_still_turns_off(plugin, caplog):
    MANAGER.sync(ON)

    def boom():
        raise RuntimeError("stuck")

    plugin.instance.stop = boom
    MANAGER.stop_all()
    assert plugin.running is False
    assert any("Plugin fake failed while stopping: stuck" in m for m in caplog.messages)


def test_an_instance_without_methods_still_turns_on_and_off(plugin):
    plugin.instance = Bare()
    MANAGER.sync(ON)
    assert plugin.running is True
    MANAGER.sync(ON)  # sem update nem set_locale: nada a chamar
    assert MANAGER.status()["fake"] == {"state": "ok", "label": "On", "error": None}
    MANAGER.stop_all()
    assert plugin.running is False


def test_status_for_the_editor(plugin, caplog):
    assert MANAGER.status() == {"fake": {"state": "off", "label": "Off", "error": None}}
    MANAGER.sync(ON)
    plugin.instance.status = {"state": "ok", "label": "Connected", "detail": "v2"}
    assert MANAGER.status()["fake"] == {"state": "ok", "label": "Connected", "detail": "v2", "error": "v2"}
    plugin.instance.status = ValueError("broken")
    assert MANAGER.status()["fake"] == {"state": "error", "label": "Error", "error": "broken"}
    MANAGER.status()  # o mesmo erro de novo: não repete o aviso no log
    assert sum("couldn't read its status" in m for m in caplog.messages) == 1


def test_run_guard_blocks_actions_of_a_plugin_that_is_off(plugin):
    d = actions.ActionDef("fake.go", lambda s, c: None, (), None, None, plugin="fake")
    with pytest.raises(RuntimeError, match="the 'Fake' integration is turned off"):
        run_guard(d)
    MANAGER.sync(ON)
    run_guard(d)  # ligado: passa
    run_guard(actions.ActionDef("hotkey", lambda s, c: None, (), None, None))  # ação do app: nunca barra
    gone = actions.ActionDef("gone.go", lambda s, c: None, (), None, None, plugin="gone")
    with pytest.raises(RuntimeError, match="the 'gone' integration is turned off"):
        run_guard(gone)


def test_secrets_and_shortcuts_from_the_settings(plugin):
    plugin.manifest["settings"] = [*MANIFEST["settings"], {"name": "mute", "kind": "shortcut", "default": "f13"}]
    assert MANAGER.secret_paths() == [("fake", "token")]
    assert MANAGER.secret_values({"fake": {"token": "s3cret"}}) == ["s3cret"]
    assert MANAGER.secret_values({"fake": {"token": True}}) == []
    assert MANAGER.shortcuts_in({"fake": {}}) == [("f13", "fake", "mute")]
    assert MANAGER.shortcuts_in({"fake": {"enabled": False}}) == []
