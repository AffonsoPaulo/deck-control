"""Prévias das teclas, widgets montados, valores ao vivo e imagens dos ícones."""

from __future__ import annotations

import base64
import io
import re
from pathlib import Path

from app import actions, icons, logs, values, widgets
from app.editor.api.context import Context
from app.i18n import tr

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.plugins import PluginManager
    from app.values import Values

log = logs.get("editor")


def preview(ctx: Context, body: dict):
    """[{icon, active_icon, action}] -> [{normal, active|null}] em data URLs PNG."""
    out = []
    base = ctx.config_path.parent
    defaults = body.get("icons") if isinstance(body.get("icons"), dict) else None
    get = _sample_getter(ctx.plugins, ctx.values)
    wdefs = None
    for item in body.get("keys", []):
        if not item:
            out.append(None)
            continue
        if item.get("widget"):  # widget: monta as células do tamanho escolhido
            if wdefs is None:
                wdefs = widgets.all_defs(body.get("widgets"))
            built = widgets.expand(item, wdefs, "preview")
            item = {
                **item,
                "span": list(built["span"]),
                "cells": built["cells"],
                "icon": built["icon"],
                "mode": "split",
            }
        icon = item.get("icon") or {}
        if isinstance(icon, str):
            icon = {"text": icon}
        span = item.get("span") or [1, 1]
        if span != [1, 1] and item.get("mode") == "image" and icon.get("image"):
            try:
                gap = int(((body.get("device") or {}).get("gap_px")) or 28)
                tiles = icons.block_slices(icons._image_path(icon, base), int(span[0]), int(span[1]), gap)
                out.append({"normal": None, "active": None, "cells": [_png(t) for t in tiles]})
            except (OSError, ValueError):
                out.append({"normal": _preview({"text": "?"}, base, defaults), "active": None})
            continue
        if span != [1, 1] and item.get("cells"):
            cells = [c if isinstance(c, dict) else {"text": str(c)} for c in item["cells"]]
            out.append(
                {
                    "normal": None,
                    "active": None,
                    "cells": [_preview(values.resolve_icon(c, get), base, defaults) for c in cells],
                }
            )
            continue
        icon = values.resolve_icon(icon, get)
        res = {"normal": _preview(icon, base, defaults), "active": None}
        has_state = item.get("state") or actions.state_of(item.get("action"), "x:0")
        if has_state:
            override = item.get("active_icon") or {"bg": "#C62828"}
            if isinstance(override, str):
                override = {"text": override}
            res["active"] = _preview(icons.merge_icon(icon, values.resolve_icon(override, get)), base, defaults)
        out.append(res)
    return {"images": out}


def widget_expand(ctx: Context, body: dict):
    """{key: {widget, size, options, colors}, widgets} -> o widget montado (para separar em teclas e as ações padrão)."""
    k = body.get("key") if isinstance(body.get("key"), dict) else {}
    built = widgets.expand(k, widgets.all_defs(body.get("widgets")), str(body.get("id") or "key"))
    return {**built, "span": list(built["span"])}


def values_now(ctx: Context, _body: dict):
    """Valor atual de cada valor (para a lista do editor e as etiquetas de prévia)."""
    from app.schema import schema as _schema

    get = _sample_getter(ctx.plugins, ctx.values)
    out = {}
    for v in _schema()["values"]:
        val = get(v["id"])
        out[v["id"]] = None if val is None else values._fmt(val, None)
    return {"values": out}


def upload(ctx: Context, body: dict):
    """Salva uma imagem enviada pelo navegador em icons/ ao lado do config."""
    name = re.sub(r"[^\w.\-]+", "_", Path(str(body.get("name", "imagem.png"))).name)[:80] or "imagem.png"
    data = base64.b64decode(body["data"].split(",", 1)[-1])
    if len(data) > 5 * 1024 * 1024:
        raise ValueError(tr("image larger than 5 MB"))
    folder = ctx.config_path.parent / "icons"
    folder.mkdir(exist_ok=True)
    target = folder / name
    stem, suffix, n = target.stem, target.suffix, 1
    while target.exists() and target.read_bytes() != data:
        target = folder / f"{stem}-{n}{suffix}"
        n += 1
    target.write_bytes(data)
    return {"path": f"icons/{target.name}"}


def image_info(ctx: Context, body: dict):
    """Nome, tamanho, quadros (GIF) e uma miniatura da imagem de um ícone, para o cartão da aba Aparência."""
    from PIL import Image

    path = icons._image_path({"image": str(body.get("path") or "")}, ctx.config_path.parent)
    try:
        with Image.open(path) as im:
            info = {
                "name": path.name,
                "width": im.width,
                "height": im.height,
                "frames": int(getattr(im, "n_frames", 1) or 1),
            }
            first = im.convert("RGBA")
    except (OSError, ValueError):
        return {"name": path.name, "missing": True}
    frames = icons._gif_frames(path) or []
    if len(frames) > 1:
        small = []
        for fr, ms in frames:
            t = fr.copy()
            t.thumbnail((88, 88))
            small.append((t, ms))
        buf = io.BytesIO()
        small[0][0].save(
            buf,
            format="WEBP",
            save_all=True,
            append_images=[f for f, _ in small[1:]],
            duration=[ms for _, ms in small],
            loop=0,
            quality=80,
        )
        info["thumb"] = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
    else:
        first.thumbnail((88, 88))
        info["thumb"] = _png(first)
    return info


def _sample_getter(plugins: "PluginManager", live: "Values"):
    """Valor atual; sem ele (plugin desligado, app fechado), o exemplo declarado, para a prévia não ficar vazia."""
    samples = {}
    try:
        for v in values.describe() + plugins.value_schemas():
            samples[v["id"]] = v.get("sample")
    except Exception:
        log.debug("Couldn't read the sample values", exc_info=True)

    def get(name):
        v = live.get(name)
        if v is None and name.startswith("timer."):
            return "05:00" if name.count(".") == 1 else 100 if name.endswith(".pct") else False
        return samples.get(name) if v is None else v

    return get


def _preview(icon, base, defaults) -> str:
    """PNG, ou WebP animado quando o ícone usa um GIF animado (a prévia anima também)."""
    if not icon.get("image"):
        return _png(icons.render_icon(icon, base, defaults))
    frames = icons.render_frames(icon, base, defaults)
    if len(frames) < 2:
        return _png(frames[0][0])
    buf = io.BytesIO()
    frames[0][0].save(
        buf,
        format="WEBP",
        save_all=True,
        append_images=[f for f, _ in frames[1:]],
        duration=[ms for _, ms in frames],
        loop=0,
        quality=85,
    )
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def _png(img) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
