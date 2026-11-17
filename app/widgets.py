"""Widgets: peças prontas de informação (Relógio, Data, Contagem…) que ocupam uma ou mais teclas.

Uma tecla com widget guarda só a referência e as escolhas da pessoa:
    widget: app.clock      size: 1x3      options: {format: "12"}      colors: {bg: "#1d2330", fg: "#ffffff"}
O desenho de cada tamanho vem do modelo do widget ("sizes": linhas de células) e é montado aqui, na hora,
tanto para o Deck (config.build_config) quanto para as prévias do editor. Nos textos do modelo:
    {opt.<nome>}  vira o valor da opção        $id  vira um id único da tecla (contagens)

De onde vêm os modelos: os do app (BUILTIN), os dos plugins ("widgets" no plugin.json) e os da pessoa
("widgets:" no config, criados com "Salvar como widget").
"""

from __future__ import annotations

import copy
import json
import re

from app.i18n import tr

# categorias fixas, na ordem da biblioteca (plugins escolhem uma delas; fora da lista vira "other").
# A cor é o nome da matiz do tokens.css do editor (--cat-<matiz>): mesmo assunto, mesma cor das ações.
CATEGORIES = [
    ("time", "Time", "violet"),
    ("system", "System", "green"),
    ("stream", "Streaming", "teal"),
    ("media", "Media", "pink"),
    ("weather", "Weather", "sky"),
    ("chat", "Chat", "indigo"),
    ("other", "Other", "gray"),
]
CATEGORY_IDS = [c[0] for c in CATEGORIES]
# tipos de opção (os mesmos campos das ações, mais "value": escolher um valor do app/plugins)
OPTION_KINDS = ("choice", "bool", "number", "text", "color", "glyph", "value")
OPT = re.compile(r"\{opt\.([A-Za-z0-9_]+)\}")
BG = "#1d2330"  # mesmo valor de --key-graphite no tokens.css do editor
MAX_ROWS, MAX_COLS = 3, 5


def categories() -> list[dict]:
    return [{"id": i, "label": tr(label), "hue": hue, "color": f"var(--cat-{hue})"} for i, label, hue in CATEGORIES]


def builtin() -> dict:
    # cada número numa tecla, com a legenda embaixo (opção) e a virada quando muda (opção "animate")
    def clock_part(text: str, label: str) -> dict:
        return {
            "text": text,
            "sub": {"$opt": "labels", "true": label},
            "style": "info",
            "text_size": 46,
            "bg": BG,
            "transition": {"$opt": "animate", "true": "flip"},
        }

    hour = clock_part("{clock.hour{opt.format}}", tr("hours"))
    minute = clock_part("{clock.minute}", tr("minutes"))
    second = clock_part("{clock.second}", tr("seconds"))
    day = {"text": "{clock.weekday_short}", "sub": "{clock.day} {clock.month}", "bg": BG}
    clock_fmt = {
        "name": "format",
        "kind": "choice",
        "label": tr("Format"),
        "default": "",
        "choices": [["", tr("24 h")], ["12", tr("12 h")]],
    }
    clock_opts = [
        clock_fmt,
        {"name": "labels", "kind": "bool", "label": tr("Labels below"), "default": True},
        {
            "name": "third",
            "kind": "choice",
            "label": tr("Third key (1×3)"),
            "default": "date",
            "choices": [["date", tr("Date")], ["seconds", tr("Seconds")]],
        },
        {"name": "animate", "kind": "bool", "label": tr("Animate the change"), "default": True},
    ]
    timer_cell = {
        "lucide": "hourglass",
        "text": "{timer.$id}",
        "sub": tr("Countdown"),
        "bg": "#2b2440",
        "fg": "#ffffff",
    }
    gauge = {
        "lucide": "{opt.icon}",
        "text": "{{opt.value}}%",
        "bg": BG,
        "bar": {"value": "{opt.value}", "min": 0, "max": 100, "color": "{opt.color}"},
    }
    gauge_opts = [
        {"name": "value", "kind": "value", "label": tr("Value"), "default": "system.volume", "kinds": ["number"]},
        {"name": "icon", "kind": "glyph", "label": tr("Icon"), "default": "volume-2"},
        {"name": "color", "kind": "color", "label": tr("Bar color"), "default": "#F5A524"},
    ]
    return {
        "app.clock": {
            "label": tr("Clock"),
            "icon": "clock",
            "category": "time",
            "options": clock_opts,
            "sizes": {
                "1x1": [
                    [
                        {
                            "text": "{clock.time{opt.format}}",
                            "sub": "{clock.weekday_short}, {clock.day} {clock.month}",
                            "bg": BG,
                            "transition": {"$opt": "animate", "true": "flip"},
                        }
                    ]
                ],
                "1x2": [[hour, minute]],
                "1x3": [[hour, minute, {"$opt": "third", "date": day, "seconds": second}]],
                "2x2": [
                    [hour, minute],
                    [
                        {"text": "{clock.weekday}", "style": "info", "bg": BG},
                        {"text": "{clock.day}", "sub": "{clock.month}", "bg": BG},
                    ],
                ],
            },
        },
        "app.date": {
            "label": tr("Date"),
            "icon": "calendar",
            "category": "time",
            "sizes": {
                "1x1": [[{"text": "{clock.day}", "sub": "{clock.weekday_short}, {clock.month}", "bg": BG}]],
                "1x2": [
                    [
                        {"text": "{clock.weekday_short}", "style": "info", "bg": BG},
                        {"text": "{clock.day}", "sub": "{clock.month}", "bg": BG},
                    ]
                ],
            },
        },
        "app.countdown": {
            "label": tr("Countdown"),
            "icon": "hourglass",
            "category": "time",
            "options": [{"name": "minutes", "kind": "number", "label": tr("Minutes"), "default": 5}],
            "action": {"type": "timer.toggle", "id": "$id", "minutes": "{opt.minutes}"},
            "hold": {"type": "timer.reset", "id": "$id"},
            "sizes": {
                "1x1": [[timer_cell]],
                "1x2": [
                    [
                        {"lucide": "hourglass", "style": "big", "bg": "#2b2440"},
                        {
                            "text": "{timer.$id}",
                            "sub": tr("Countdown"),
                            "bg": "#2b2440",
                            "bar": {"value": "timer.$id.pct", "color": "#d9ccff"},
                        },
                    ]
                ],
            },
        },
        "app.gauge": {
            "label": tr("Gauge"),
            "icon": "gauge",
            "category": "system",
            "options": gauge_opts,
            "sizes": {
                "1x1": [[gauge]],
                "1x2": [[{"lucide": "{opt.icon}", "style": "big", "bg": BG}, {**gauge, "lucide": None}]],
            },
        },
        "app.free": {
            "label": tr("Free value"),
            "icon": "braces",
            "category": "other",
            "options": [
                {"name": "value", "kind": "value", "label": tr("Value"), "default": "deck.page"},
                {"name": "caption", "kind": "text", "label": tr("Second line"), "default": tr("page")},
            ],
            "sizes": {"1x1": [[{"text": "{{opt.value}}", "sub": "{opt.caption}", "bg": BG}]]},
        },
    }


# ---------------------------------------------------------------------------- validação de um modelo


def parse_size(size) -> tuple[int, int] | None:
    """'2x3' -> (2 linhas, 3 colunas), ou None se não for um tamanho válido."""
    try:
        r, c = (int(x) for x in str(size).lower().split("x"))
    except ValueError:
        return None
    return (r, c) if 1 <= r <= MAX_ROWS and 1 <= c <= MAX_COLS else None


def check(name: str, d) -> str | None:
    """O problema do modelo (texto já traduzido) ou None. Usado para plugins e para os widgets da pessoa."""
    if not isinstance(d, dict) or not isinstance(d.get("sizes"), dict) or not d["sizes"]:
        return tr("the widget '{name}' needs 'sizes'", name=name)
    for size, rows in d["sizes"].items():
        rc = parse_size(size)
        ok = (
            rc is not None
            and isinstance(rows, list)
            and len(rows) == rc[0]
            and all(isinstance(x, list) and len(x) == rc[1] for x in rows)
        )
        if not ok:
            return tr(
                "the widget '{name}' has an invalid size '{size}' (rows x columns, with that many cells)",
                name=name,
                size=size,
            )
    opts = d.get("options", [])
    if not isinstance(opts, list):
        return tr("the widget '{name}': 'options' must be a list", name=name)
    for o in opts:
        if not isinstance(o, dict) or not o.get("name") or o.get("kind") not in OPTION_KINDS:
            return tr(
                "the widget '{name}' has an invalid option {option} (kind: {kinds})",
                name=name,
                option=repr(o),
                kinds=", ".join(OPTION_KINDS),
            )
        if o["kind"] == "choice" and not isinstance(o.get("choices"), list):
            return tr("the widget '{name}': the option '{option}' needs 'choices'", name=name, option=o["name"])
    names = {o["name"] for o in opts}
    for ref in _variant_refs(d.get("sizes")):
        if ref not in names:
            return tr(
                "the widget '{name}': '$opt' points to the option '{option}', which doesn't exist",
                name=name,
                option=ref,
            )
    return None


def _variant_refs(obj) -> list[str]:
    """As opções citadas em variantes ({"$opt": "nome", ...}), em qualquer nível do modelo."""
    out: list[str] = []
    if isinstance(obj, dict):
        if "$opt" in obj:
            out.append(str(obj["$opt"]))
        for v in obj.values():
            out += _variant_refs(v)
    elif isinstance(obj, list):
        for v in obj:
            out += _variant_refs(v)
    return out


def normalize(d: dict, plugin: str | None = None, color: str | None = None) -> dict:
    """O modelo como o editor e o expand() esperam (categoria válida, campos que faltam)."""
    cat = d.get("category")
    return {
        "label": d.get("label") or "?",
        "icon": d.get("icon") or "layout-grid",
        "category": cat if cat in CATEGORY_IDS else "other",
        "plugin": plugin,
        "color": color,
        "options": d.get("options") or [],
        "sizes": d.get("sizes") or {},
        **({"action": d["action"]} if d.get("action") else {}),
        **({"hold": d["hold"]} if d.get("hold") else {}),
    }


def user_defs(raw_widgets) -> dict:
    """Os widgets da pessoa ("widgets:" no config); os inválidos ficam de fora (o config.build_config avisa)."""
    out = {}
    if isinstance(raw_widgets, dict):
        for name, d in raw_widgets.items():
            if check(str(name), d) is None:
                out[str(name)] = {**normalize(d), "category": "mine", "mine": True}
    return out


def all_defs(raw_widgets=None) -> dict:
    """Todos os modelos: do app, dos plugins ligados e da pessoa."""
    from app.plugins import MANAGER

    return {**{k: normalize(v) for k, v in builtin().items()}, **MANAGER.widget_schemas(), **user_defs(raw_widgets)}


# ---------------------------------------------------------------------------- montar uma tecla


def option_values(d: dict, chosen) -> dict:
    vals = {o["name"]: o.get("default", "") for o in d.get("options", [])}
    if isinstance(chosen, dict):
        vals.update(chosen)
    return vals


def _branch(value) -> str:
    """Nome do ramo de uma variante para o valor da opção: true/false para sim/não, o próprio texto nos outros."""
    return ("true" if value else "false") if isinstance(value, bool) else str(value)


def _fill(obj, opts: dict, kid: str):
    """Troca {opt.x} e $id em todos os textos (o resto fica como está). Um texto que é só {opt.x} vira o valor cru.
    Variante por opção: {"$opt": "nome", "<valor>": ...} vira o ramo do valor escolhido (sem ramo: some)."""
    if isinstance(obj, dict) and "$opt" in obj:
        picked = obj.get(_branch(opts.get(str(obj["$opt"]))))
        return None if picked is None else _fill(picked, opts, kid)
    if isinstance(obj, str):
        whole = OPT.fullmatch(obj)
        if whole and whole.group(1) in opts and not isinstance(opts[whole.group(1)], str):
            return opts[whole.group(1)]
        s = OPT.sub(lambda m: "" if opts.get(m.group(1)) is None else str(opts.get(m.group(1))), obj)
        return s.replace("$id", kid)
    if isinstance(obj, list):
        return [_fill(x, opts, kid) for x in obj]
    if isinstance(obj, dict):
        filled = {k: _fill(v, opts, kid) for k, v in obj.items() if v is not None}
        return {k: v for k, v in filled.items() if v is not None}
    return obj


def key_id(options: dict, fallback: str) -> str:
    """O id das contagens: o que o editor guardou ao colocar o widget (não muda ao mover a tecla)."""
    kid = (options or {}).get("id") if isinstance(options, dict) else None
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(kid or fallback))


def expand(k: dict, defs: dict, fallback_id: str = "key") -> dict:
    """{widget, size, options, colors} -> {span, cells, icon, action?, hold?} prontos para desenhar.

    Widget que não existe mais (plugin desligado, removido) vira um aviso no lugar, sem quebrar o config."""
    d = defs.get(k.get("widget"))
    size = str(k.get("size") or "")
    rc = parse_size(size) or (1, 1)
    if d is None or size not in d["sizes"]:
        label = d["label"] if d else str(k.get("widget"))
        cell = {"lucide": "circle-help", "text": label, "sub": tr("unavailable"), "bg": "#262d38", "fg": "#c4cad4"}
        return {
            "span": (rc[1], rc[0]),
            "cells": [dict(cell) for _ in range(rc[0] * rc[1])],
            "icon": dict(cell),
            "missing": True,
        }
    opts = option_values(d, k.get("options"))
    kid = key_id(k.get("options"), fallback_id)
    cells = [c for row in _fill(copy.deepcopy(d["sizes"][size]), opts, kid) for c in row]
    colors = k.get("colors") if isinstance(k.get("colors"), dict) else {}
    for c in cells:
        if colors.get("bg") and not isinstance(c.get("bg"), dict):
            c["bg"] = colors["bg"]
        if colors.get("fg"):
            c["fg"] = colors["fg"]
    out = {"span": (rc[1], rc[0]), "cells": cells, "icon": dict(cells[0]) if len(cells) == 1 else {"text": d["label"]}}
    for moment in ("action", "hold"):
        if d.get(moment):
            out[moment] = _fill(copy.deepcopy(d[moment]), opts, kid)
    return out


def same(a, b) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)
