"""Seção pages do config: cada tecla (validada e montada como KeySpec), os blocos e as páginas citadas.

Cada função devolve os problemas que achou (padrão Notification), na ordem em que aparecem no arquivo; quem
junta tudo e mostra é o build_config (app/config.py).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app import actions, icons, lighting, values, widgets
from app.configmodel import MOMENTS, Checked, Cover, Icon, KeySpec, Pages, child_actions
from app.errors import ConfigError
from app.i18n import tr
from d6.device import COLS, KEY_COUNT

DEFAULT_ACTIVE_OVERRIDE = {"bg": "#C62828"}

KEY_FIELDS = frozenset(
    {
        "icon",
        "active_icon",
        "state",
        "action",
        "double",
        "hold",
        "hold_ms",
        "release",
        "light",
        "repeat",
        "repeat_ms",
        "repeat_delay",
        "rules",
        "span",
        "cells",
        "mode",
        "widget",
        "size",
        "options",
        "colors",
    }
)
WIDGET_FIELDS = ("widget", "size", "options", "colors")  # trocados pelo desenho montado do modelo
NUMBER_RANGES = (("repeat_ms", 20, 2000), ("repeat_delay", 0, 3000), ("hold_ms", 50, 10000))

WidgetDefs = Callable[[], dict[str, Any]]


def build_pages(raw_pages: dict[Any, Any], raw_widgets: object) -> Checked[Pages]:
    """Todas as páginas, tecla por tecla. As teclas com problema ficam de fora (e entram na lista)."""
    problems: list[str] = []
    loaded: list[dict[str, Any]] = []

    def widget_defs() -> dict[str, Any]:
        # os modelos só são lidos se alguma tecla usar widget
        if not loaded:
            loaded.append(widgets.all_defs(raw_widgets))
        return loaded[0]

    pages: Pages = {}
    for page_name, keys in raw_pages.items():
        page_name = str(page_name)
        pages[page_name] = {}
        if keys and not isinstance(keys, dict):
            # a página fica (vazia): home e as ações 'page' que apontam para ela não viram outro problema
            problems.append(tr("pages.{page}: expected an object (key number: key)", page=page_name))
            continue
        for key_id, k in (keys or {}).items():
            built = build_key(page_name, key_id, k, widget_defs)
            problems += built.problems
            if built.value is not None:
                n, spec = built.value
                pages[page_name][n] = spec
    return Checked(pages, problems)


def build_key(
    page_name: str, key_id: object, k: object, widget_defs: WidgetDefs
) -> Checked[tuple[int, KeySpec] | None]:
    """Uma tecla: (número, KeySpec), ou None se ficou de fora (vazia ou com um problema que impede montar)."""
    where = f"pages.{page_name}.{key_id}"
    problems: list[str] = []
    try:
        n = int(key_id)  # type: ignore[call-overload]  # o que veio do YAML; o erro vira mensagem
    except (TypeError, ValueError):
        return Checked(None, [tr("{where}: the key must be a number from 1 to {n}", where=where, n=KEY_COUNT)])
    if not 1 <= n <= KEY_COUNT:
        return Checked(None, [tr("{where}: the key must be from 1 to {n}", where=where, n=KEY_COUNT)])
    if k is None:
        return Checked(None, [])
    if not isinstance(k, dict):
        return Checked(None, [tr("{where}: expected an object with icon/action", where=where)])
    unknown = set(k) - KEY_FIELDS
    if unknown:
        problems.append(tr("{where}: unknown fields {fields}", where=where, fields=sorted(unknown)))
    if k.get("widget") is not None:
        # widget: o desenho vem do modelo, montado agora (span e células); o resto da tecla vale igual
        if any(f in k for f in ("span", "cells", "mode")):
            problems.append(tr("{where}: a widget key can't have span, cells or mode", where=where))
        if widgets.parse_size(k.get("size")) is None:
            problems.append(tr("{where}.size: use rows x columns, e.g. 1x3", where=where))
            return Checked(None, problems)
        built = widgets.expand(k, widget_defs(), f"{page_name}-{n}")
        k = {
            **{f: v for f, v in k.items() if f not in WIDGET_FIELDS},
            "span": list(built["span"]),
            "cells": built["cells"],
            "icon": built["icon"],
        }
    for moment in MOMENTS:
        problems += actions.validate(k.get(moment), f"{where}.{moment}")
    rules = k.get("rules") or []
    if not isinstance(rules, list):
        problems.append(tr("{where}.rules: expected a list", where=where))
        rules = []
    for ri, rule in enumerate(rules):
        problems += values.check_cond(
            (rule or {}).get("if") if isinstance(rule, dict) else None, f"{where}.rules.{ri + 1}"
        )
    span = _span(k.get("span"), n, where, problems)
    if k.get("mode") not in (None, "split", "image"):
        problems.append(tr("{where}.mode: use split or image", where=where))
    if k.get("repeat") not in (None, "press", "hold"):
        problems.append(tr("{where}.repeat: use press or hold", where=where))
    for f, lo, hi in NUMBER_RANGES:
        v = k.get(f)
        if v is not None and not (isinstance(v, (int, float)) and lo <= v <= hi):
            problems.append(tr("{where}.{field}: a number from {lo} to {hi}", where=where, field=f, lo=lo, hi=hi))
    problems += lighting.validate_key(k.get("light"), f"{where}.light")
    try:
        icon = _icon(k.get("icon"), f"{where}.icon")
        active_override = _icon(k.get("active_icon"), f"{where}.active_icon") or DEFAULT_ACTIVE_OVERRIDE
    except ConfigError as e:
        problems.append(str(e))
        return Checked(None, problems)
    state = k.get("state") or actions.state_of(k.get("action"), f"{page_name}:{n}")
    spec = KeySpec(
        icon=icon,
        active_icon=icons.merge_icon(icon, active_override),
        state=state,
        action=actions.normalize(k.get("action")),
        hold=actions.normalize(k.get("hold")),
        hold_ms=int(k.get("hold_ms", 500)),
        release=actions.normalize(k.get("release")),
        light=k.get("light") if isinstance(k.get("light"), dict) else None,
        double=actions.normalize(k.get("double")),
        repeat=k.get("repeat") if k.get("repeat") in ("press", "hold") else None,
        repeat_ms=int(k.get("repeat_ms", 80)),
        repeat_delay=int(k.get("repeat_delay", 400)),
        rules=[r for r in rules if isinstance(r, dict)],
        span=span,
        cells=[c if isinstance(c, dict) else {"text": str(c)} for c in (k.get("cells") or [])],
        mode=k.get("mode") or "split",
        dynamic=_is_dynamic(k),
    )
    return Checked((n, spec), problems)


def _span(value: Any, n: int, where: str, problems: list[str]) -> tuple[int, int]:
    """span: [colunas, linhas]; o bloco tem que caber na grade a partir da tecla n."""
    if value is None:
        return (1, 1)
    try:
        cols, rows = int(value[0]), int(value[1])
    except (TypeError, ValueError, IndexError):
        problems.append(tr("{where}.span: use [columns, rows], e.g. [2, 1]", where=where))
        return (1, 1)
    col, row = (n - 1) % COLS, (n - 1) // COLS
    if cols < 1 or rows < 1 or col + cols > COLS or row + rows > KEY_COUNT // COLS:
        # w e h trocados de propósito: a mensagem fala em "linhas x colunas", como o size dos widgets
        problems.append(
            tr("{where}.span: a {w}x{h} block doesn't fit starting at this key", where=where, w=rows, h=cols)
        )
        return (1, 1)
    return (cols, rows)


def _icon(value: object, where: str) -> Icon:
    if value is None:
        return {}
    if isinstance(value, str):
        return {"text": value}
    if not isinstance(value, dict):
        raise ConfigError(tr("{where}: the icon must be text or an object with bg/text/lucide/image", where=where))
    return dict(value)


def _is_dynamic(k: dict[str, Any]) -> bool:
    """Mostra valores ({id}), tem regras, barra ou cor por faixa: precisa ser redesenhada sozinha."""
    if k.get("rules"):
        return True
    for icon in [k.get("icon"), k.get("active_icon"), *(k.get("cells") or [])]:
        if isinstance(icon, dict):
            if isinstance(icon.get("bar"), dict) or isinstance(icon.get("bg"), dict):
                return True
            if any(values.has_tokens(v) for v in icon.values()):
                return True
        elif values.has_tokens(icon):
            return True
    return False


def cover_blocks(pages: Pages) -> Checked[Cover]:
    """Blocos: as teclas cobertas apontam para a do canto; não podem ter nada próprio nem cruzar outro bloco."""
    problems: list[str] = []
    cover: Cover = {}
    for page_name, keys in pages.items():
        cov = cover.setdefault(page_name, {})
        for n, k in sorted(keys.items()):
            cols, rows = k.span
            if (cols, rows) == (1, 1):
                continue
            idx = 0
            for r in range(rows):
                for c in range(cols):
                    other = n + r * COLS + c
                    if other != n:
                        if other in keys:
                            problems.append(
                                tr(
                                    "pages.{page}.{key}: the key is inside the {w}x{h} block of key {anchor}",
                                    page=page_name,
                                    key=other,
                                    w=rows,
                                    h=cols,
                                    anchor=n,
                                )
                            )
                        elif other in cov:
                            problems.append(
                                tr(
                                    "pages.{page}: blocks of keys {a} and {b} overlap",
                                    page=page_name,
                                    a=cov[other][0],
                                    b=n,
                                )
                            )
                        cov[other] = (n, idx)
                    idx += 1
    return Checked(cover, problems)


def page_refs(spec: object) -> list[str]:
    """Todas as páginas citadas por ações 'page' (inclusive dentro de multi/toggle/if)."""
    spec = actions.normalize(spec)
    if not isinstance(spec, dict):
        return []
    out = []
    if spec.get("type") == "page":
        out.append(str(spec.get("page")))
    for child in child_actions(spec):
        out += page_refs(child)
    return out


def check_page_refs(pages: Pages) -> list[str]:
    """As ações 'page' só podem apontar para páginas que existem (ou back/home)."""
    problems = []
    for page_name, keys in pages.items():
        for n, k in keys.items():
            for ref in sum((page_refs(a) for a in k.moments()), []):
                if ref not in pages and ref not in ("back", "home"):
                    problems.append(
                        tr(
                            "pages.{page}.{key}: 'page' action points to '{ref}', which doesn't exist",
                            page=page_name,
                            key=n,
                            ref=ref,
                        )
                    )
    return problems
