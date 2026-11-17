"""Config: ler, gravar, validar, histórico de versões, exportar e importar."""

from __future__ import annotations

import base64

import yaml

from app import history, i18n, logs, transfer
from app.config import ConfigError, build_config
from app.configio import read_plain, save_plain
from app.editor.api.context import MAX_BODY, Context
from app.i18n import tr

log = logs.get("editor")


def get_config(ctx: Context, _body: dict):
    return {"config": read_plain(ctx.config_path), "file": ctx.config_path.name}


def save_config(ctx: Context, body: dict):
    cfg = body.get("config")
    if not isinstance(cfg, dict):
        return {"ok": False, "errors": [tr("invalid config")]}
    i18n.set_language(cfg.get("language"))
    try:
        # valida exatamente como o app vai ler (PyYAML), antes de gravar
        build_config(yaml.safe_load(yaml.safe_dump(cfg, allow_unicode=True)), ctx.config_path)
    except ConfigError as e:
        errors = str(e).split("\n  - ")[1:] or [str(e)]
        log.warning("Config not saved: %d problem(s): %s", len(errors), "; ".join(errors))
        return {"ok": False, "errors": errors}
    try:
        save_plain(ctx.config_path, cfg)
    except Exception as e:
        log.error("Saving the config failed: %s", e, exc_info=True, extra={"ctx": {"file": str(ctx.config_path)}})
        raise
    log.info("Config saved from the editor")
    history.record(ctx.config_path)
    return {"ok": True}


def validate(ctx: Context, body: dict):
    from app.binds import conflicts

    raw = body.get("config") or {}
    try:
        out = {"conflicts": conflicts(raw)}
    except Exception:  # um config pela metade não pode derrubar a validação
        log.debug("Shortcut conflict check failed (config being edited)", exc_info=True)
        out = {"conflicts": []}
    try:
        build_config(raw, ctx.config_path)
        return {"ok": True, **out}
    except ConfigError as e:
        return {"ok": False, "errors": str(e).split("\n  - ")[1:] or [str(e)], **out}


def history_list(ctx: Context, _body: dict):
    return {"entries": history.entries(ctx.config_path)}


def history_restore(ctx: Context, body: dict):
    when = history.restore(ctx.config_path, str(body["id"]))
    return {"config": read_plain(ctx.config_path), "when": when}


def export(ctx: Context, body: dict):
    name, data = transfer.export_zip(ctx.config_path, bool(body.get("include_secrets")))
    return {"name": name, "data": base64.b64encode(data).decode()}


def import_config(ctx: Context, body: dict):
    name = transfer.safe_filename(body.get("name", "arquivo"))
    raw = base64.b64decode(str(body["data"]).split(",", 1)[-1])
    if len(raw) > MAX_BODY:
        raise ValueError(tr("file too large"))
    plain, images = transfer.read_import(name, raw)
    if body.get("dry_run"):
        return {"summary": transfer.summarize_import(plain, images)}
    try:
        new = transfer.build_import(ctx.config_path, plain, images, body.get("mode", "replace"))
    except ConfigError as e:
        log.warning("Import of %s refused: the config has problems", name)
        return {"ok": False, "errors": str(e).split("\n  - ")[1:] or [str(e)]}
    save_plain(ctx.config_path, new)
    log.info("Config imported from %s (%s)", name, body.get("mode", "replace"))
    history.record(ctx.config_path, reason=f"Importado de {name}")
    return {"ok": True, "config": read_plain(ctx.config_path)}
