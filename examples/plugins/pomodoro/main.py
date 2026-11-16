"""Plugin de exemplo do D6: Pomodoro.

Mostra o protocolo dos plugins de terceiros (ver PLUGINS.md): o app manda mensagens JSON,
uma por linha, no stdin; o plugin responde no stdout. Só usa a biblioteca padrão do Python.

Idiomas: os textos ficam em locales/<idioma>.json (os mesmos arquivos que o plugin.json usa
com "%chave%"). O app manda o idioma no "hello" e de novo numa mensagem "locale" se mudar.
"""
import json
import sys
import threading
import time
from pathlib import Path

lock = threading.Lock()
settings = {"focus": 25, "pause": 5, "sound": True}
phase = "focus"          # focus | pause
remaining = None         # segundos que faltam (None = ainda não começou)
running = False
locale = "en"
LOCALES = {}
for _f in (Path(__file__).parent / "locales").glob("*.json"):
    LOCALES[_f.stem] = json.loads(_f.read_text(encoding="utf-8"))


def t(key, **kw):
    """Texto no idioma do app: exato (pt-BR) -> base (pt) -> inglês -> a própria chave."""
    for lang in (locale, locale.split("-")[0], "en"):
        if key in LOCALES.get(lang, {}):
            return LOCALES[lang][key].format(**kw)
    return key


def send(msg):
    with lock:
        sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def minutes(name):
    try:
        return max(1, int(float(settings.get(name) or 1)))
    except (TypeError, ValueError):
        return 1


def publish():
    send({"type": "state", "name": "pomodoro.running", "value": running})
    send({"type": "state", "name": "pomodoro.break", "value": phase == "pause"})
    if remaining is None:
        send({"type": "status", "state": "ok", "label": t("status.ready")})
    else:
        left = max(0, int(remaining + 59) // 60)
        label = t("status.focus" if phase == "focus" else "status.break", min=left)
        send({"type": "status", "state": "ok" if running else "wait",
              "label": label if running else t("status.paused", status=label)})


def beep():
    if settings.get("sound", True):
        try:
            import winsound
            winsound.MessageBeep(winsound.MB_ICONASTERISK)
        except Exception:
            pass


def ticker():
    global remaining, phase
    last = time.monotonic()
    shown = None
    while True:
        time.sleep(0.5)
        now = time.monotonic()
        with lock:
            pass
        if running and remaining is not None:
            remaining -= now - last
            if remaining <= 0:
                phase = "pause" if phase == "focus" else "focus"
                remaining = minutes(phase) * 60
                beep()
                shown = None
        last = now
        key = (running, phase, None if remaining is None else int(remaining + 59) // 60)
        if key != shown:
            shown = key
            publish()


def handle(msg):
    global running, remaining, phase, settings, locale
    kind = msg.get("type")
    if msg.get("locale"):
        locale = msg["locale"]
    if kind == "locale":
        publish()
    elif kind in ("hello", "settings"):
        settings = {**settings, **(msg.get("settings") or {})}
        publish()
    elif kind == "action":
        name = msg.get("action")
        if name == "pomodoro.toggle":
            if remaining is None:
                remaining = minutes("focus") * 60
                phase = "focus"
            running = not running
        elif name == "pomodoro.reset":
            running, remaining, phase = False, None, "focus"
        else:
            send({"type": "result", "id": msg.get("id"), "ok": False, "error": t("error.unknown_action", name=name)})
            return
        publish()
        send({"type": "result", "id": msg.get("id"), "ok": True})
    elif kind == "stop":
        sys.exit(0)


def main():
    threading.Thread(target=ticker, daemon=True).start()
    for line in sys.stdin:
        line = line.strip()
        if line:
            try:
                handle(json.loads(line))
            except ValueError:
                send({"type": "log", "message": f"mensagem inválida: {line[:80]}"})


if __name__ == "__main__":
    main()
