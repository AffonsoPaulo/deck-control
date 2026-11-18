"""O app e o aparelho: estado, Sobre, iniciar com o Windows, abrir pastas, OBS, testar tecla, atalhos."""

from __future__ import annotations

import threading

from app import logs
from app.editor.api.context import Context

log = logs.get("editor")


def status(ctx: Context, _body: dict):
    e = ctx.engine
    if e is None:
        s = logs.summary()
        return {
            "engine": False,
            "logs": {"new_errors": s["new_errors"], "last": s["last"]},
            "problems": logs.problems(),
        }

    s = logs.summary()
    return {
        "engine": True,
        "device": e.device_connected,
        "page": e.page,
        "obs": bool(e.obs and e.obs.req is not None),
        "plugins": ctx.plugins.status(),
        "logs": {"new_errors": s["new_errors"], "last": s["last"]},
        "problems": logs.problems(),
    }


def about(ctx: Context, _body: dict):
    """Dados da seção Sobre e o 'iniciar com o Windows'."""
    from app import winutil

    e = ctx.engine
    try:
        autostart = winutil.autostart_enabled()
    except Exception:
        log.debug("Couldn't read the autostart setting", exc_info=True)
        autostart = None
    return {
        "firmware": e.firmware if e else None,
        "device": bool(e and e.device_connected),
        "autostart": autostart,
        "config": str(ctx.config_path),
        "log": str(winutil.log_path()),
    }


def autostart(ctx: Context, body: dict):
    from app import winutil

    try:
        winutil.set_autostart(bool(body.get("enabled")), ctx.config_path)
    except winutil.AutostartBlocked as e:
        raise ValueError(str(e)) from None  # o editor mostra a mensagem no aviso
    return {"autostart": winutil.autostart_enabled()}


def open_path(ctx: Context, body: dict):
    """Abre o log, a pasta dos logs ou a pasta do app no Windows (só esses)."""
    import os
    from app import winutil

    what = body.get("what")
    target = {"log": winutil.log_path(), "logs": logs.log_dir(), "folder": ctx.config_path.parent}.get(what)
    if target is None:
        raise ValueError(f"what to open? (log, logs or folder, got {what!r})")
    log.debug("Opening %s: %s", what, target)
    os.startfile(str(target))
    return {"ok": True}


def obs(ctx: Context, _body: dict):
    return ctx.engine.obs_lists() if ctx.engine else {"connected": False}


def press(ctx: Context, body: dict):
    ctx.need_engine().press(str(body["page"]), int(body["key"]), body.get("which", "action"))
    return {"ok": True}


def show(ctx: Context, body: dict):
    ctx.need_engine().go_to_page(str(body["page"]))
    return {"ok": True}


def free_bind(ctx: Context, body: dict):
    """Próximas combinações livres, considerando o config em edição (ainda não salvo)."""
    from app.binds import free_combos

    rules = body.get("rules") if isinstance(body.get("rules"), dict) else None
    return {"combos": free_combos(body.get("config") or {}, int(body.get("count", 1)), rules, body.get("taken") or ())}


def send_combo(ctx: Context, body: dict):
    """Aperta uma combinação depois de N segundos (para gravar o atalho em outro programa)."""
    from app import keys

    combo = str(body["keys"])
    keys.parse_combo(combo)  # valida antes de agendar
    delay = max(0.0, min(15.0, float(body.get("delay", 5))))
    threading.Timer(delay, keys.press_combo, args=(combo,), kwargs={"hold_ms": 80}).start()
    return {"ok": True}


def record(ctx: Context, body: dict):
    """Gravar pela tecla do D6: a próxima tecla apertada só manda o atalho (sem rodar a ação)."""
    e = ctx.need_engine()
    if body.get("cancel"):
        e.cancel_record()
        return {"ok": True}
    from app import keys

    combo = str(body["keys"])
    keys.parse_combo(combo)
    e.arm_record(combo, float(body.get("seconds", 30)))
    return {"ok": True}


def record_state(ctx: Context, _body: dict):
    return ctx.need_engine().record_state()
