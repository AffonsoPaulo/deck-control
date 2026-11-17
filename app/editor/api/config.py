"""Config: ler, gravar, validar, histórico de versões, exportar e importar."""

from __future__ import annotations

import base64

import yaml

from app import i18n, logs, transfer
from app.config import ConfigError
from app.editor.api.context import MAX_BODY, Context
from app.i18n import tr

log = logs.get("editor")


def get_config(ctx: Context, _body: dict):
    return {"config": ctx.store.read_plain(), "file": ctx.config_path.name}


def save_config(ctx: Context, body: dict):
    cfg = body.get("config")
    if not isinstance(cfg, dict):
        return {"ok": False, "errors": [tr("invalid config")]}
    i18n.set_language(cfg.get("language"))
    try:
        # valida exatamente como o app vai ler (PyYAML), antes de gravar
        ctx.store.validate(yaml.safe_load(yaml.safe_dump(cfg, allow_unicode=True)))
    except ConfigError as e:
        errors = str(e).split("\n  - ")[1:] or [str(e)]
        log.warning("Config not saved: %d problem(s): %s", len(errors), "; ".join(errors))
        return {"ok": False, "errors": errors}
    try:
        ctx.store.save(cfg)
    except Exception as e:
        log.error("Saving the config failed: %s", e, exc_info=True, extra={"ctx": {"file": str(ctx.config_path)}})
        raise
    log.info("Config saved from the editor")
    ctx.store.record()
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
        ctx.store.validate(raw)
        return {"ok": True, **out}
    except ConfigError as e:
        return {"ok": False, "errors": str(e).split("\n  - ")[1:] or [str(e)], **out}


def history_list(ctx: Context, _body: dict):
    return {"entries": ctx.store.versions()}


def history_restore(ctx: Context, body: dict):
    store = ctx.store
    when = store.restore(str(body["id"]))
    return {"config": store.read_plain(), "when": when}


def export(ctx: Context, body: dict):
    name, data = transfer.export_zip(ctx.config_path, bool(body.get("include_secrets")))
    return {"name": name, "data": base64.b64encode(data).decode()}


def import_config(ctx: Context, body: dict):
    name = transfer.safe_filename(body.get("name", "arquivo"))
    raw = base64.b64decode(str(body["data"]).split(",", 1)[-1])
    if len(raw) > MAX_BODY:
        raise ValueError(tr("file too large"))
    try:
        plain, images = transfer.read_import(name, raw)
    except transfer.NotADeckSetup as e:
        # um arquivo que não é config do Deck é problema do arquivo, como os do config: {ok: false}, não erro 500
        log.warning("Import of %s refused: the file has no pages section", name)
        return {"ok": False, "errors": [str(e)]}
    if body.get("dry_run"):
        return {"summary": transfer.summarize_import(plain, images)}
    try:
        new = transfer.build_import(ctx.config_path, plain, images, body.get("mode", "replace"))
    except ConfigError as e:
        log.warning("Import of %s refused: the config has problems", name)
        return {"ok": False, "errors": str(e).split("\n  - ")[1:] or [str(e)]}
    store = ctx.store
    store.save(new)
    log.info("Config imported from %s (%s)", name, body.get("mode", "replace"))
    store.record(reason=f"Importado de {name}")
    return {"ok": True, "config": store.read_plain()}
