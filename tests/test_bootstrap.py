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


def test_version_comes_from_the_package():
    from app import __version__

    r = run_python("", "-m", "app", "--version")
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == f"Deck {__version__}"


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


def test_user_files_stay_where_they_were_in_development(tmp_path, monkeypatch):
    from app import paths

    monkeypatch.setenv("APPDATA", str(tmp_path / "roaming"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    assert paths.config_dir() == ROOT
    assert paths.default_config() == ROOT / "config.yaml"
    assert paths.history_dir() == tmp_path / "local" / "D6Deck" / "history"
    assert paths.old_config() is None
    assert not (tmp_path / "roaming").exists()  # nada é criado em %APPDATA% fora do executável


def test_user_files_go_to_appdata_in_the_executable(tmp_path, monkeypatch):
    from app import paths

    monkeypatch.setenv("APPDATA", str(tmp_path / "roaming"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    deck = tmp_path / "roaming" / "Deck"
    assert paths.default_config(frozen=True) == deck / "config.yaml"
    assert deck.is_dir()  # criada na hora: o exemplo é copiado para lá na primeira abertura
    assert paths.history_dir(frozen=True) == deck / "history"
    assert paths.data_dir() == tmp_path / "local" / "D6Deck"  # logs e plugins não mudam de lugar


def test_old_config_is_the_one_next_to_the_executable(tmp_path):
    from app import paths

    exe = tmp_path / "Deck" / "Deck.exe"
    exe.parent.mkdir()
    assert paths.old_config(frozen=True, executable=str(exe)) is None
    (exe.parent / "config.yaml").write_text("pages: {}\n", encoding="utf-8")
    assert paths.old_config(frozen=True, executable=str(exe)) == exe.parent / "config.yaml"
    assert paths.old_config(frozen=False, executable=str(exe)) is None


def test_resources_the_package_needs_exist_in_the_project():
    from app import paths

    # o editor só existe depois do npm run build; o resto vem no repositório
    assert [m for m in paths.missing_resources() if not m.startswith("editor:")] == []
    assert all(p.is_relative_to(paths.ROOT) for p in paths.RESOURCES.values())


def test_autostart_runs_the_main_script():
    from app import paths, winutil

    cmd = winutil.autostart_command(ROOT / "config.yaml")
    assert f'"{paths.MAIN_SCRIPT}" --tray --config' in cmd


def test_autostart_command_in_development():
    # caracterização (antes da Fase 7): o pythonw (ou o Python que roda os testes), o __main__.py e o config
    from app import paths, winutil

    cfg = ROOT / "config.yaml"
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    exe = pythonw if pythonw.exists() else Path(sys.executable)
    assert winutil.autostart_command(cfg) == f'"{exe}" "{paths.MAIN_SCRIPT}" --tray --config "{cfg.resolve()}"'


def test_autostart_command_in_the_executable(tmp_path, monkeypatch):
    from app import paths, winutil

    monkeypatch.setenv("APPDATA", str(tmp_path))
    exe = r"C:\Program Files\Deck\Deck.exe"
    default = paths.default_config(frozen=True)
    assert winutil.autostart_command(default, frozen=True, executable=exe) == f'"{exe}" --tray'
    other = tmp_path / "teste" / "config.yaml"
    assert winutil.autostart_command(other, frozen=True, executable=exe) == f'"{exe}" --tray --config "{other}"'


def test_dll_reset_keeps_the_current_folder_out(monkeypatch):
    """O executável tira a _internal da busca de DLLs com "" (não None, que poria a pasta atual de volta)."""
    import ctypes

    from app import winutil

    calls = []
    fake = type("K", (), {"SetDllDirectoryW": staticmethod(lambda v: calls.append(v) or 1)})()
    monkeypatch.setattr(ctypes, "windll", type("W", (), {"kernel32": fake})(), raising=False)
    winutil.reset_dll_directory()
    assert calls == [""]
