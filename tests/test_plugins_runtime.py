"""Como o plugin de terceiros roda (Fase 6): "runtime" e "protocol" no manifesto, o comando que o app abre e o
modo --run-plugin, que roda um plugin em Python com o Python do app (no executável, o Deck.exe)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from app import paths
from app.plugins import MANAGER, PluginError, check_manifest
from app.plugins.external import command
from app.plugins.manifest import PROTOCOL, python_run, runtime_of
from app.plugins.runner import PythonTarget, parse_run

PROBE = Path(__file__).parent / "fakes" / "probe_plugin.py"
PYTHON = sys.executable.replace("pythonw.exe", "python.exe")
OK = {"id": "meu-plugin", "name": "Meu plugin", "run": ["python", "main.py"]}


# ---------------------------------------------------------------------------- manifesto


@pytest.mark.parametrize(
    ("manifest", "runtime", "run"),
    [
        ({"run": ["python", "main.py"]}, "deck-python", ["main.py"]),  # manifesto antigo
        ({"run": ["python3", "-m", "x"]}, "deck-python", ["-m", "x"]),
        ({"run": ["pythonw", "main.py", "--a"]}, "deck-python", ["main.py", "--a"]),
        ({"run": ["node", "main.js"]}, "exe", ["node", "main.js"]),
        ({"run": ["C:/Python/python.exe", "main.py"]}, "exe", ["C:/Python/python.exe", "main.py"]),
        ({"runtime": "deck-python", "run": ["main.py"]}, "deck-python", ["main.py"]),
        ({"runtime": "deck-python", "run": ["python", "main.py"]}, "deck-python", ["main.py"]),
        ({"runtime": "exe", "run": ["python", "main.py"]}, "exe", ["main.py"]),  # escrito "exe": roda como está
    ],
)
def test_runtime_of(manifest, runtime, run):
    assert runtime_of(manifest) == runtime
    if runtime == "deck-python" or manifest.get("runtime") == "exe":
        assert python_run(manifest) == run


def test_runtime_and_protocol_are_optional():
    check_manifest(dict(OK), builtin=False)
    check_manifest({**OK, "runtime": "exe", "run": ["bin/plugin.exe"], "protocol": PROTOCOL}, builtin=False)
    check_manifest({**OK, "runtime": "deck-python", "run": ["-u", "-m", "meu_plugin"]}, builtin=False)
    check_manifest({**OK, "run": ["python", "-X", "utf8", "main.py"]}, builtin=False)  # antigo: confere ao abrir


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"runtime": "node"}, '\'runtime\' must be "exe" or "deck-python"'),
        ({"protocol": 0}, "'protocol' must be a whole number"),
        ({"protocol": "1"}, "'protocol' must be a whole number"),
        ({"protocol": True}, "'protocol' must be a whole number"),
        ({"protocol": 1.5}, "'protocol' must be a whole number"),
        ({"runtime": "deck-python", "run": ["python"]}, "'run' needs the plugin's Python script"),
        ({"runtime": "deck-python", "run": ["-m"]}, "'run' has -m without the module name"),
        ({"runtime": "deck-python", "run": ["-X", "utf8", "a.py"]}, "uses the Python option -X"),
    ],
)
def test_runtime_and_protocol_problems(change, message):
    with pytest.raises(PluginError) as e:
        check_manifest({**OK, **change}, builtin=False)
    assert message in str(e.value)


def test_a_newer_protocol_says_to_update_the_deck():
    with pytest.raises(PluginError) as e:
        check_manifest({**OK, "protocol": PROTOCOL + 1}, builtin=False)
    assert str(e.value) == (
        f"this plugin needs version {PROTOCOL + 1} of the plugin protocol, and this Deck only has version "
        f"{PROTOCOL}. Update the Deck to use it."
    )


def test_a_plugin_that_needs_a_newer_protocol_shows_up_as_not_loaded():
    from app.plugins import user_dir

    folder = user_dir() / "futuro"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        json.dumps({"id": "futuro", "name": "Futuro", "run": ["main.exe"], "protocol": 99}), encoding="utf-8"
    )
    try:
        MANAGER.load()
        assert "futuro" not in MANAGER.plugins
        (err,) = [e for e in MANAGER.errors if e["folder"] == "futuro"]
        assert "needs version 99 of the plugin protocol" in err["error"]
    finally:
        shutil.rmtree(folder)
        MANAGER.load()


@pytest.mark.parametrize(
    ("run", "target"),
    [
        (["main.py"], PythonTarget("main.py", None, ())),
        (["main.py", "-m", "x"], PythonTarget("main.py", None, ("-m", "x"))),  # depois do script, é argumento
        (["-u", "-B", "src/main.py", "--a"], PythonTarget("src/main.py", None, ("--a",), no_bytecode=True)),
        (["-m", "pkg.main", "--a"], PythonTarget(None, "pkg.main", ("--a",))),
    ],
)
def test_parse_run(run, target):
    assert parse_run(run) == target


# ---------------------------------------------------------------------------- o comando


def test_command_for_python_plugins(tmp_path):
    for m in ({"run": ["python", "main.py"]}, {"runtime": "deck-python", "run": ["main.py"]}):
        assert command(m, tmp_path, frozen=False) == [PYTHON, str(paths.MAIN_SCRIPT), "--run-plugin", str(tmp_path)]
        # no executável (Fase 7), o próprio Deck.exe roda o plugin
        assert command(m, tmp_path, frozen=True, executable="C:/Deck/Deck.exe") == [
            "C:/Deck/Deck.exe",
            "--run-plugin",
            str(tmp_path),
        ]
    pythonw = str(Path(PYTHON).with_name("pythonw.exe"))
    assert command(OK, tmp_path, frozen=False, executable=pythonw)[0] == str(Path(PYTHON).with_name("python.exe"))


def test_command_for_programs(tmp_path):
    (tmp_path / "bin").mkdir()
    (tmp_path / "bin" / "plugin.exe").write_bytes(b"")
    (tmp_path / "node").write_bytes(b"")
    exe = {"runtime": "exe", "run": ["bin/plugin.exe", "--x"]}
    assert command(exe, tmp_path) == [str(tmp_path / "bin" / "plugin.exe"), "--x"]  # o que o plugin traz
    assert command({"runtime": "exe", "run": ["node", "main.js"]}, tmp_path)[0] == str(tmp_path / "node")
    assert command({"runtime": "exe", "run": ["dotnet", "x.dll"]}, tmp_path) == ["dotnet", "x.dll"]  # do PATH
    assert command({"run": ["node", "main.js"]}, tmp_path) == ["node", "main.js"]  # manifesto antigo: como era


# ---------------------------------------------------------------------------- o modo --run-plugin


def make_plugin(tmp_path: Path, run: list[str], files: dict[str, str] | None = None, **manifest) -> Path:
    folder = tmp_path / "plugin"
    folder.mkdir(parents=True)
    (folder / "plugin.json").write_text(
        json.dumps({"id": "probe", "name": "Probe", "run": run, **manifest}), encoding="utf-8"
    )
    for name, text in (files or {}).items():
        (folder / name).parent.mkdir(parents=True, exist_ok=True)
        (folder / name).write_text(text, encoding="utf-8")
    return folder


def run_cmd(cmd: list[str], folder: Path, stdin: str = '{"type": "stop"}\n') -> subprocess.CompletedProcess:
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1", "D6_PLUGIN_ID": "probe"}
    return subprocess.run(
        cmd, cwd=folder, env=env, input=stdin, capture_output=True, text=True, encoding="utf-8", timeout=60
    )


def run_plugin(folder: Path, stdin: str = '{"type": "stop"}\n') -> subprocess.CompletedProcess:
    return run_cmd([PYTHON, str(paths.MAIN_SCRIPT), "--run-plugin", str(folder)], folder, stdin)


def test_run_plugin_looks_like_plain_python(tmp_path):
    """O plugin antigo vê o mesmo que via quando o app abria `python main.py` (só a pasta lib/ entra)."""
    facts = {}
    for how in ("old", "new"):
        folder = make_plugin(tmp_path / how, ["python", "main.py", "--flag"])
        shutil.copy(PROBE, folder / "main.py")
        (folder / "lib").mkdir()
        cmd = [PYTHON, "main.py", "--flag"] if how == "old" else None
        r = run_cmd(cmd, folder) if cmd else run_plugin(folder)
        assert (r.returncode, r.stdout, r.stderr) == (0, "", "")
        text = (folder / "facts.json").read_text(encoding="utf-8")
        facts[how] = json.loads(text.replace(json.dumps(str(folder))[1:-1], "<F>"))
    old, new = facts["old"], facts["new"]
    assert new["path"] == [old["path"][0], "<F>\\lib", *old["path"][1:]]
    assert {k: v for k, v in new.items() if k != "path"} == {k: v for k, v in old.items() if k != "path"}
    assert new["argv"] == ["main.py", "--flag"] and new["name"] == "__main__" and new["app_loaded"] == []


SCRIPT = """
import sys, json
import helper            # da pasta lib/ do plugin
import app               # o "app.py" do plugin, não o pacote do Deck
print(json.dumps({"helper": helper.X, "app": app.WHO, "argv": sys.argv}))
sys.exit(int(sys.argv[1]))
"""


def test_run_plugin_uses_lib_and_the_plugins_own_modules(tmp_path):
    folder = make_plugin(
        tmp_path,
        ["python", "main.py", "5"],
        {"main.py": SCRIPT, "lib/helper.py": "X = 'from lib'\n", "app.py": "WHO = 'plugin'\n"},
    )
    r = run_plugin(folder)
    assert r.returncode == 5, r.stderr  # o sys.exit do plugin vira o código de saída
    assert json.loads(r.stdout) == {"helper": "from lib", "app": "plugin", "argv": ["main.py", "5"]}


def test_run_plugin_with_a_module_and_a_package_in_lib(tmp_path):
    folder = make_plugin(
        tmp_path,
        ["-B", "-m", "meu_plugin", "--a"],
        {
            "lib/meu_plugin/__init__.py": "",
            "lib/meu_plugin/__main__.py": "import sys\nprint(__name__, sys.argv[1:], sys.dont_write_bytecode)\n",
        },
        runtime="deck-python",
    )
    r = run_plugin(folder)
    assert (r.returncode, r.stdout.strip()) == (0, "__main__ ['--a'] True"), r.stderr


def test_run_plugin_errors(tmp_path):
    folder = make_plugin(tmp_path, ["python", "main.py"], {"main.py": "raise ValueError('broken plugin')\n"})
    r = run_plugin(folder)
    assert r.returncode == 1 and r.stdout == ""  # como o Python: traceback no stderr (vai para o log do app)
    assert "ValueError: broken plugin" in r.stderr

    (folder / "main.py").unlink()
    r = run_plugin(folder)
    assert (r.returncode, r.stderr) == (2, "--run-plugin plugin: the script main.py doesn't exist\n")

    exe = make_plugin(tmp_path / "exe", ["node", "main.js"])
    r = run_plugin(exe)
    assert (r.returncode, r.stderr) == (2, "--run-plugin plugin: this plugin's runtime isn't \"deck-python\"\n")

    old = make_plugin(tmp_path / "old", ["python", "-X", "utf8", "main.py"])
    r = run_plugin(old)
    assert r.returncode == 2 and "uses the Python option -X" in r.stderr

    r = run_cmd([PYTHON, str(paths.MAIN_SCRIPT), "--run-plugin"], tmp_path)
    assert (r.returncode, r.stderr) == (2, "usage: --run-plugin <plugin folder>\n")
