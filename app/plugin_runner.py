"""Modo --run-plugin: roda um plugin de terceiros em Python ("runtime": "deck-python") com o Python do app.

O app abre `python app/__main__.py --run-plugin <pasta>` (no executável, `Deck.exe --run-plugin <pasta>`), com a
pasta do plugin como pasta de trabalho, e conversa com esse processo pelo protocolo de sempre
(app/plugins/external.py). Aqui o processo deixa de ser o app e vira o plugin, o mais parecido possível com
`python main.py` na pasta dele:

- o sys.argv é o do run (o script e os argumentos), e o script roda como __main__ (__file__ com o caminho todo);
- no sys.path: a pasta do script, depois a pasta lib/ do plugin (as bibliotecas que ele traz, na frente das do
  Python) e o resto do caminho do Python; a pasta do app sai;
- os módulos do app saem do sys.modules: o plugin não enxerga o app (e pode ter um módulo chamado "app");
- erro e saída são os do Python: exceção sem tratar mostra o traceback no stderr (que vai para o log do app) e
  sai com 1; sys.exit(n) sai com n.

Fica fora do pacote app.plugins de propósito: importar aquele pacote carrega o app inteiro (ações, valores,
widgets) e mais de cem módulos do Python, que ficariam no lugar de um módulo do plugin com o mesmo nome. Daqui só
saem os módulos de que este arquivo precisa (o plugin.json é lido aqui mesmo; quem valida tudo é o app, ao
carregar o plugin).

Opções do Python no run: -m <módulo>, -u (a saída já vai sem buffer) e -B (não grava .pyc). Outras não.
"""

from __future__ import annotations

import builtins
import importlib.machinery
import io
import json
import os
import sys
import types
from pathlib import Path
from typing import Any, NamedTuple

from app.errors import PluginError
from app.i18n import tr

RUNTIMES = ("exe", "deck-python")  # "exe": o run é um programa que o plugin traz; "deck-python": o app roda o Python
PYTHON = ("python", "python3", "pythonw")  # um run que começa assim, sem "runtime", é deck-python (manifesto antigo)
LIB = "lib"  # a pasta das bibliotecas do plugin


def runtime_of(m: dict[str, Any]) -> str:
    """Como o plugin de terceiros roda: o "runtime" do manifesto ou, sem ele, pelo run (python… = deck-python)."""
    rt = m.get("runtime")
    if rt in RUNTIMES:
        return str(rt)
    run = m.get("run") or []
    return "deck-python" if run and run[0] in PYTHON else "exe"


def python_run(m: dict[str, Any]) -> list[str]:
    """deck-python: o run sem o "python" da frente (o script, ou -m módulo, e os argumentos)."""
    run = [str(x) for x in m.get("run") or []]
    return run[1:] if run and run[0] in PYTHON else run


class PythonTarget(NamedTuple):
    """O que o run de um plugin deck-python pede: um script ou um módulo (-m), com os argumentos."""

    script: str | None
    module: str | None
    args: tuple[str, ...]
    no_bytecode: bool = False  # -B


def parse_run(run: list[str]) -> PythonTarget:
    """O run sem o "python" da frente: ["main.py", "--x"], ["-u", "main.py"], ["-m", "meu_plugin"]..."""
    no_bytecode = False
    for i, arg in enumerate(run):
        if arg == "-m":
            if i + 1 >= len(run) or not run[i + 1]:
                raise PluginError(tr('\'run\' has -m without the module name (e.g.: ["-m", "my_plugin"])'))
            return PythonTarget(None, run[i + 1], tuple(run[i + 2 :]), no_bytecode)
        if arg == "-B":
            no_bytecode = True
        elif arg == "-u":
            pass  # o app já abre o plugin sem buffer na saída (PYTHONUNBUFFERED)
        elif arg.startswith("-"):
            raise PluginError(
                tr("'run' uses the Python option {option}, which the Deck doesn't run (only -m, -u and -B)", option=arg)
            )
        else:
            return PythonTarget(arg, None, tuple(run[i + 1 :]), no_bytecode)
    raise PluginError(tr("'run' needs the plugin's Python script (e.g.: [\"main.py\"])"))


def main(argv: list[str], drop_from_path: list[str]) -> int:
    """`--run-plugin <pasta>`. drop_from_path: o que o app/__main__.py pôs no sys.path (sai antes do plugin)."""
    from app import i18n

    i18n.set_language("en")  # o que sair daqui vai para o log do app, que é em inglês
    if len(argv) != 2 or argv[0] != "--run-plugin":
        sys.stderr.write("usage: --run-plugin <plugin folder>\n")
        return 2
    folder = Path(argv[1]).resolve()
    try:
        target = _target(folder)
    except PluginError as e:
        sys.stderr.write(f"--run-plugin {folder.name}: {e}\n")
        return 2
    os.chdir(folder)  # quem abre é o app, já nesta pasta; à mão, de outra pasta, fica igual
    _like_plain_python()
    if target.no_bytecode:
        sys.dont_write_bytecode = True
    if target.module is not None:
        import runpy

        _isolate(str(folder), folder, drop_from_path)
        sys.argv = ["-m", *target.args]  # como o python -m: o runpy troca o "-m" pelo caminho do módulo
        runpy.run_module(target.module, run_name="__main__", alter_sys=True)
        return 0
    assert target.script is not None
    script = (folder / target.script).resolve()
    if not script.is_file():
        sys.stderr.write(f"--run-plugin {folder.name}: the script {target.script} doesn't exist\n")
        return 2
    _isolate(str(script.parent), folder, drop_from_path)
    sys.argv = [target.script, *target.args]
    _run_script(script)
    return 0


def _target(folder: Path) -> PythonTarget:
    try:
        m = json.loads((folder / "plugin.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise PluginError(tr("plugin.json is missing")) from None
    except (OSError, ValueError) as e:
        raise PluginError(tr("invalid plugin.json: {error}", error=e)) from None
    run = m.get("run") if isinstance(m, dict) else None
    if not (isinstance(run, list) and run and all(isinstance(x, str) for x in run)):
        raise PluginError(tr('\'run\' must be the plugin\'s command line, as a list (e.g.: ["python", "main.py"])'))
    if runtime_of(m) != "deck-python":
        raise PluginError(tr("this plugin's runtime isn't \"deck-python\""))
    return parse_run(python_run(m))


def _like_plain_python() -> None:
    """O que o Python do executável não faz sozinho e o `python main.py` faz.

    O PyInstaller roda o Python isolado (sys.flags.ignore_environment e no_site): ele não lê as variáveis
    PYTHON* que o app põe ao abrir o plugin (app/plugins/external.py) e não cria o exit()/quit() do site. Sem
    isso o plugin sairia em cp1252 e com a saída presa no buffer (a resposta só chegaria ao app quando o buffer
    enchesse). E o PyInstaller aponta a busca de DLLs para a pasta _internal, o que os programas que o plugin
    abrir herdariam (winutil.reset_dll_directory, aqui sem importar o app). Fora do executável o Python já fez
    tudo isso e aqui nada muda.
    """
    if getattr(sys, "frozen", False):
        import ctypes

        ctypes.windll.kernel32.SetDllDirectoryW("")  # "" e não None: a pasta atual fica fora da busca de DLLs
    if sys.flags.ignore_environment:
        encoding, _, errors = (os.environ.get("PYTHONIOENCODING") or "").partition(":")
        unbuffered = bool(os.environ.get("PYTHONUNBUFFERED"))
        if isinstance(sys.stdin, io.TextIOWrapper):
            sys.stdin.reconfigure(encoding=encoding or None, errors=errors or None)
        for name, fd, err in (("stdout", 1, errors or None), ("stderr", 2, "backslashreplace")):
            old = getattr(sys, name)
            if not isinstance(old, io.TextIOWrapper):
                continue  # sem a saída (None): nada a ajustar
            if unbuffered:  # como o python -u: sem buffer embaixo, cada write vai direto para o pipe
                raw = io.FileIO(fd, "w", closefd=False)
                setattr(
                    sys, name, io.TextIOWrapper(raw, encoding or old.encoding, err or old.errors, write_through=True)
                )
            else:
                old.reconfigure(encoding=encoding or None, errors=err)
    if not hasattr(builtins, "exit"):
        import _sitebuiltins

        builtins.exit = _sitebuiltins.Quitter("exit", "Ctrl-Z plus Return")
        builtins.quit = _sitebuiltins.Quitter("quit", "Ctrl-Z plus Return")


def _isolate(first: str, folder: Path, drop_from_path: list[str]) -> None:
    """O sys.path e o sys.modules de um Python que acabou de abrir o plugin."""
    drop = {os.path.normcase(os.path.abspath(p)) for p in drop_from_path}
    rest = [p for p in sys.path if os.path.normcase(os.path.abspath(p or ".")) not in drop]
    lib = folder / LIB
    sys.path[:] = [first, *([str(lib)] if lib.is_dir() else []), *rest]
    for name in [n for n in sys.modules if n in ("app", "d6") or n.startswith(("app.", "d6."))]:
        del sys.modules[name]
    # sem importlib.invalidate_caches(): as pastas novas do sys.path ganham buscadores novos, e no 3.12 ele
    # carregaria o importlib.metadata (e com ele email, zipfile, socket...) no processo do plugin


def _run_script(script: Path) -> None:
    """Como o `python script.py`: um módulo __main__ novo, com __file__ e o loader de arquivo."""
    main = types.ModuleType("__main__")
    main.__file__ = str(script)
    main.__loader__ = importlib.machinery.SourceFileLoader("__main__", str(script))
    main.__dict__["__builtins__"] = builtins
    main.__dict__["__cached__"] = None
    main.__spec__ = None
    main.__package__ = None
    sys.modules["__main__"] = main
    code = compile(script.read_bytes(), str(script), "exec")  # bytes: o compile respeita o "# coding:" do arquivo
    exec(code, main.__dict__)
