"""Schema do editor (ações, widgets, valores, plugins) e plugins de terceiros: inspecionar, instalar, remover."""

from __future__ import annotations

import base64
import io
from pathlib import Path

import yaml

from app import i18n, logs
from app.editor.api.context import MAX_BODY, Context
from app.i18n import tr
from app.schema import schema

log = logs.get("editor")


def get_schema(ctx: Context, _body: dict):
    # o editor pode abrir antes de o engine ler o config (ou sem engine, nos testes)
    try:
        raw = yaml.safe_load(ctx.config_path.read_text(encoding="utf-8")) or {}
        i18n.set_language(raw.get("language") if isinstance(raw, dict) else None)
    except (OSError, yaml.YAMLError) as e:
        log.debug("api_schema: couldn't read the language from the config: %s", e)
    return schema()


def plugin_inspect(ctx: Context, body: dict):
    import shutil
    from app.plugins import localize, read_locales

    folder, m = _plugin_zip(body)
    try:
        existing = ctx.plugins.plugins.get(m["id"])
        m = localize(m, read_locales(folder))
        return {
            "manifest": {
                k: m.get(k)
                for k in (
                    "id",
                    "name",
                    "version",
                    "author",
                    "description",
                    "icon",
                    "color",
                    "permissions",
                    "homepage",
                )
            },
            "actions": [d.get("label") for d in m.get("actions", {}).values()],
            "installed": existing.manifest.get("version") if existing and not existing.builtin else None,
            "builtin_conflict": bool(existing and existing.builtin),
        }
    finally:
        shutil.rmtree(folder if folder.name.startswith("d6plugin-") else folder.parent, ignore_errors=True)


def plugin_install(ctx: Context, body: dict):
    import shutil
    from app.schema import schema

    folder, m = _plugin_zip(body)
    try:
        ctx.plugins.install(folder, replace=bool(body.get("replace")))
    finally:
        shutil.rmtree(folder if folder.name.startswith("d6plugin-") else folder.parent, ignore_errors=True)
    return {"ok": True, "id": m["id"], "schema": schema()}


def plugin_remove(ctx: Context, body: dict):
    from app.schema import schema

    ctx.plugins.remove(str(body.get("id", "")))
    return {"ok": True, "schema": schema()}


def _plugin_zip(body: dict) -> tuple[Path, dict]:
    """Abre o .zip num diretório temporário e devolve (pasta do plugin, manifesto)."""
    import tempfile
    import zipfile
    from app.plugins import PluginError, read_manifest

    raw = base64.b64decode(str(body["data"]).split(",", 1)[-1])
    if len(raw) > MAX_BODY:
        raise ValueError(tr("file too large"))
    tmp = Path(tempfile.mkdtemp(prefix="d6plugin-"))
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            names = z.namelist()
            if len(names) > 2000:
                raise PluginError(tr("the .zip has too many files"))
            total = 0
            for info in z.infolist():
                target = (tmp / info.filename).resolve()
                if not str(target).startswith(str(tmp.resolve())):
                    raise PluginError(tr("the .zip has invalid paths"))
                total += info.file_size
                if total > 200 * 1024 * 1024:
                    raise PluginError(tr("the unzipped plugin is over 200 MB"))
            z.extractall(tmp)
    except zipfile.BadZipFile:
        raise PluginError(tr("the file isn't a valid .zip")) from None
    folder = tmp
    if not (folder / "plugin.json").exists():
        subs = [d for d in tmp.iterdir() if d.is_dir()]
        if len(subs) == 1 and (subs[0] / "plugin.json").exists():
            folder = subs[0]
    return folder, read_manifest(folder, builtin=False)
