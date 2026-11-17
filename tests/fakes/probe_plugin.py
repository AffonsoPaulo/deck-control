"""Plugin de terceiros de mentira para os testes do protocolo (tests/test_plugins_external.py).

Só usa a biblioteca padrão. Grava em facts.json como foi aberto (argv, pasta, sys.path...) e em
received.jsonl cada mensagem que chegou. O que ele faz numa ação vem do parâmetro "do".
"""

import json
import os
import sys
import time

FACTS = {
    "argv": sys.argv,
    "cwd": os.getcwd(),
    "file": __file__,
    "name": __name__,
    "path0": sys.path[0],
    "path": sys.path,
    "app_loaded": sorted(m for m in sys.modules if m == "app" or m.startswith(("app.", "d6"))),
    "plugin_id": os.environ.get("D6_PLUGIN_ID"),
    "unbuffered": os.environ.get("PYTHONUNBUFFERED"),
    "stdout_encoding": sys.stdout.encoding,
    "stdin_encoding": sys.stdin.encoding,
    "executable": sys.executable,
}
with open("facts.json", "w", encoding="utf-8") as f:
    json.dump(FACTS, f)


def send(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


settings = {}
for line in sys.stdin:
    with open("received.jsonl", "a", encoding="utf-8") as f:
        f.write(line)
    msg = json.loads(line)
    kind = msg.get("type")
    if kind == "hello":
        settings = msg.get("settings") or {}
        if settings.get("crash_on_hello"):
            sys.exit(3)
        sys.stderr.write("probe: hello on stderr\n")
        sys.stderr.flush()
        send({"type": "status", "state": "ok", "label": "Ready ✓"})
    elif kind == "action":
        do = msg["params"].get("do")
        if do == "silent":
            continue  # nunca responde: o app desiste depois do tempo limite
        if do == "fail":
            send({"type": "result", "id": msg["id"], "ok": False, "error": "boom"})
            continue
        if do == "publish":
            send({"type": "state", "name": "probe.on", "value": True})
            send({"type": "state", "name": "other.on", "value": True})
            send({"type": "value", "name": "probe.temp", "value": 28})
            send({"type": "value", "name": "other.temp", "value": 1})
            send({"type": "status", "state": "weird", "label": "x" * 60})
            send({"type": "log", "level": "error", "message": "from the plugin"})
            sys.stdout.write("plain text line\n")
            sys.stdout.flush()
        if do == "crash":
            os._exit(4)
        send({"type": "result", "id": msg["id"], "ok": True})
    elif kind == "stop":
        if settings.get("ignore_stop"):
            time.sleep(30)  # não fecha: o app tem que encerrar o processo
        break
