"""Montagem do app (Fase 1): importar não liga nada, e o bootstrap carrega os plugins uma vez só.

Os testes de import rodam num Python novo (subprocess), porque o conftest.py já importou e carregou tudo.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

from app import actions, bootstrap
from app.config import build_config
from app.plugins import MANAGER
from app.values import VALUES

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / "config.example.yaml"


def run_python(code: str, *args: str, cwd: Path = ROOT) -> subprocess.CompletedProcess:
    env = {**os.environ, "LOCALAPPDATA": tempfile.mkdtemp(prefix="deck-tests-"), "PYTHONIOENCODING": "utf-8"}
    cmd = [sys.executable, "-c", code] if code else [sys.executable, *args]
    return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", timeout=60)


MODULES = [
    "app.plugins",
    "app.plugins.manifest",
    "app.plugins.api",
    "app.plugins.manager",
    "app.plugins.external",
    "app.plugin_runner",
    "app.actions",
    "app.config",
    "app.engine",
    "app.editor.server",
    "app.editor.api",
    "app.editor.api.preview",
    "app.schema",
    "app.widgets",
    "app.binds",
    "app.transfer",
    "app.tray",
    "app.bootstrap",
]


@pytest.mark.parametrize("module", MODULES)
def test_each_module_imports_first_without_loading_plugins(module):
    # antes da Fase 1, importar app.plugins primeiro quebrava (import circular actions <-> plugins)
    code = (
        f"import {module}\n"
        "from app.plugins import MANAGER\n"
        "from app import actions\n"
        "print(len(MANAGER.plugins), sum(1 for d in actions.REGISTRY.values() if d.plugin))\n"
    )
    r = run_python(code)
    assert r.returncode == 0, r.stderr
    assert r.stdout.split() == ["0", "0"]  # nenhum plugin carregado, nenhuma ação de plugin registrada


def test_services_loads_plugins_once_and_returns_the_shared_objects():
    svc = bootstrap.services()
    assert svc.plugins is MANAGER
    assert svc.values is VALUES
    before = sorted(n for n, d in actions.REGISTRY.items() if d.plugin)
    assert "obs.record" in before
    assert bootstrap.services() is svc  # a segunda chamada não carrega de novo
    assert sorted(n for n, d in actions.REGISTRY.items() if d.plugin) == before


def test_reloading_plugins_keeps_the_same_actions():
    before = sorted(n for n, d in actions.REGISTRY.items() if d.plugin)
    MANAGER.load()  # o que o editor faz depois de instalar ou remover um plugin
    assert sorted(n for n, d in actions.REGISTRY.items() if d.plugin) == before


def test_example_config_validates_after_bootstrap(example_raw):
    assert build_config(example_raw, EXAMPLE).pages


@pytest.mark.parametrize(
    ("args", "in_project"),
    [
        (["-m", "app", "--check", "--config", str(EXAMPLE)], True),
        # o "iniciar com o Windows" roda o __main__.py como script, de outra pasta
        ([str(ROOT / "app" / "__main__.py"), "--check", "--config", str(EXAMPLE)], False),
    ],
)
def test_check_command(args, in_project, tmp_path):
    r = run_python("", *args, cwd=ROOT if in_project else tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.startswith("Config OK:"), r.stdout


def test_engine_and_editor_receive_the_shared_objects(tmp_path, example_raw):
    from app.editor.server import EditorServer
    from app.engine import Engine

    cfg = tmp_path / "config.yaml"
    cfg.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    svc = bootstrap.services()
    engine = Engine(cfg, plugins=svc.plugins, values=svc.values)  # não abre o Deck: só o run() abre
    assert engine.plugins is MANAGER
    assert engine.values is VALUES
    assert VALUES.engine is engine
    editor = EditorServer(cfg, engine, port=0, plugins=svc.plugins, values=svc.values)
    try:
        assert editor.plugins is MANAGER
        assert editor.values is VALUES
    finally:
        editor.httpd.server_close()
        engine._pool.shutdown(wait=False)
        VALUES.engine = None


def test_error_hierarchy_keeps_old_imports_and_bases():
    from app import errors
    from app.config import ConfigError
    from app.plugins import PluginError

    assert ConfigError is errors.ConfigError
    assert PluginError is errors.PluginError
    for cls in (ConfigError, PluginError):
        assert issubclass(cls, errors.DeckError)
        assert issubclass(cls, ValueError)  # quem capturava ValueError continua capturando


def test_paths_point_to_the_files_the_app_ships_with():
    from app import paths

    assert not paths.FROZEN
    assert paths.ROOT == ROOT
    # o que sobrou do editor antigo e o app usa (o editor em si é o build do editor-next)
    assert (paths.STATIC / "lucide-index.json").is_file()
    assert (paths.STATIC / "fonts" / "lucide.ttf").is_file()
    assert paths.EDITOR_NEXT == ROOT / "editor-next" / "dist"
    assert (paths.LOCALES / "pt-BR.json").is_file()
    assert (paths.BUILTIN_PLUGINS / "obs" / "plugin.json").is_file()
    assert paths.MAIN_SCRIPT.is_file()
    assert paths.EXAMPLE_CONFIG.is_file()
    assert paths.default_config() == ROOT / "config.yaml"


def test_data_dir_follows_localappdata(tmp_path, monkeypatch):
    from app import paths, winutil

    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert paths.data_dir() == tmp_path / "D6Deck"
    assert (tmp_path / "D6Deck").is_dir()
    assert winutil.data_dir() == paths.data_dir()


def test_autostart_runs_the_main_script():
    from app import paths, winutil

    cmd = winutil.autostart_command(ROOT / "config.yaml")
    assert f'"{paths.MAIN_SCRIPT}" --tray --config' in cmd
