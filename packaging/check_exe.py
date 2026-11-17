"""Confere o Deck.exe montado (packaging/deck.spec), sem abrir o app de verdade nem falar com o D6.

    python packaging/check_exe.py dist/Deck/Deck.exe

Roda com APPDATA e LOCALAPPDATA numa pasta temporária (nada da pessoa é lido nem gravado) e confere:
- `--version` mostra a versão de app/__init__.py;
- `--check` com uma cópia do config.example.yaml: o config valida, os recursos do pacote estão lá
  (paths.RESOURCES) e os três plugins embutidos carregaram;
- `--run-plugin`: o Pomodoro de exemplo, sem mudança, responde ao hello pelos pipes (o exe não tem console) e sai
  no stop; e um plugin que importa partes da biblioteca padrão que o app não usa.

A CI de versão (.github/workflows/release.yml) roda este arquivo antes de montar o instalador. Sai com 1 no
primeiro problema.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import __version__  # noqa: E402

PLUGINS = ["discord", "obs", "weather"]
STDLIB = ["sqlite3", "ssl", "asyncio", "urllib.request", "email.mime.text", "xml.etree.ElementTree", "csv", "zipfile"]


def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    raise SystemExit(1)


def run(exe: Path, env: dict[str, str], *args: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    r = subprocess.run(
        [str(exe), *args], env=env, cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=120
    )
    print(f"$ Deck.exe {' '.join(args)}  -> {r.returncode}\n{r.stdout}{r.stderr}")
    return r


def readline(proc: subprocess.Popen[str], timeout: float = 30) -> str:
    out: list[str] = []
    assert proc.stdout is not None
    t = threading.Thread(target=lambda: out.append(proc.stdout.readline()), daemon=True)  # type: ignore[union-attr]
    t.start()
    t.join(timeout)
    return out[0] if out else ""


def check_pomodoro(exe: Path, env: dict[str, str], tmp: Path) -> None:
    folder = tmp / "pomodoro"
    shutil.copytree(ROOT / "examples" / "plugins" / "pomodoro", folder)
    proc = subprocess.Popen(
        [str(exe), "--run-plugin", str(folder)],
        cwd=folder,
        env={**env, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1", "D6_PLUGIN_ID": "pomodoro"},
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),  # como o app abre (app/plugins/external.py)
        text=True,
        encoding="utf-8",
    )
    assert proc.stdin is not None
    try:
        hello = {"type": "hello", "protocol": 1, "plugin": "pomodoro", "locale": "pt-BR", "settings": {}}
        proc.stdin.write(json.dumps(hello) + "\n")
        proc.stdin.flush()
        lines = [readline(proc) for _ in range(3)]
        print("pomodoro:", lines)
        if not any('"type": "status"' in line for line in lines):
            fail("the Pomodoro plugin didn't answer the hello through the pipes")
        proc.stdin.write('{"type": "stop"}\n')
        proc.stdin.flush()
        if proc.wait(30) != 0:
            fail(f"the Pomodoro plugin exited with {proc.returncode}")
    finally:
        proc.kill()


def main() -> int:
    exe = Path(sys.argv[1]).resolve()
    tmp = Path(tempfile.mkdtemp(prefix="deck-check-exe-"))
    env = {**os.environ, "APPDATA": str(tmp / "roaming"), "LOCALAPPDATA": str(tmp / "local")}
    for k in ("roaming", "local"):
        (tmp / k).mkdir()
    try:
        r = run(exe, env, "--version")
        if r.returncode != 0 or r.stdout.strip() != f"Deck {__version__}":
            fail(f"--version should print 'Deck {__version__}'")

        config = tmp / "config.yaml"
        shutil.copy(ROOT / "config.example.yaml", config)
        r = run(exe, env, "--check", "--config", str(config))
        if r.returncode != 0 or not r.stdout.startswith("Config OK:"):
            fail("--check didn't validate config.example.yaml")
        if f"Package OK: Deck {__version__}, plugins: {PLUGINS}" not in r.stdout:
            fail("--check didn't confirm the package (resources, version and built-in plugins)")

        check_pomodoro(exe, env, tmp)

        folder = tmp / "stdlib"
        folder.mkdir()
        (folder / "plugin.json").write_text(
            json.dumps({"id": "stdlib", "name": "Stdlib", "runtime": "deck-python", "run": ["main.py"]}),
            encoding="utf-8",
        )
        (folder / "main.py").write_text(f"for m in {STDLIB!r}:\n    __import__(m)\nprint('ok')\n", encoding="utf-8")
        r = run(exe, env, "--run-plugin", str(folder), cwd=folder)
        if (r.returncode, r.stdout.strip()) != (0, "ok"):
            fail("a deck-python plugin couldn't import the standard library")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"Deck.exe {__version__}: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
