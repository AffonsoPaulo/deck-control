"""Aba Logs: registros, marcar como visto e o pacote de diagnóstico."""

from __future__ import annotations

import base64
import time

from app import logs
from app.editor.api.context import Context

log = logs.get("editor")


def get_logs(ctx: Context, query: dict):
    try:
        after = int(query.get("after") or 0)
    except (TypeError, ValueError):
        after = 0
    return {
        "records": logs.records(after),
        "summary": logs.summary(),
        "problems": logs.problems(),
        "files": logs.files_info(),
        "detail": {
            "detail": bool(getattr(logs, "_detail", False)),
            "areas": sorted(getattr(logs, "_areas", ()) or ()),
            "force": bool(getattr(logs, "_force_debug", False)),
        },
    }


def logs_seen(ctx: Context, body: dict):
    upto = body.get("upto")
    logs.mark_seen(int(upto) if isinstance(upto, (int, float)) and not isinstance(upto, bool) else None)
    return {"ok": True}


def logs_diagnostics(ctx: Context, _body: dict):
    """Pacote para pedir ajuda: logs, config sem as senhas, versões, plugins e o aparelho."""
    try:
        text = ctx.store.text_without_secrets(ctx.plugins.secret_paths())
    except OSError as e:
        log.warning("Diagnostics: couldn't read the config: %s", e)
        text = None
    e = ctx.engine
    extra = {
        "plugins": [
            {"id": p.id, "version": p.manifest.get("version"), "running": p.running, "builtin": p.builtin}
            for p in ctx.plugins.plugins.values()
        ],
        "device": e.device_info() if e is not None else {"connected": False},
        "page": e.page if e is not None else None,
    }
    data = logs.diagnostics_zip(text, extra=extra)
    name = f"deck-diagnostics-{time.strftime('%Y%m%d-%H%M')}.zip"
    log.info("Diagnostics package created: %s (%d KB)", name, len(data) // 1024)
    return {"name": name, "data": base64.b64encode(data).decode()}
