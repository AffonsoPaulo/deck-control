"""Atalhos do app: onde cada combinação é usada, sobreposições e geração de combinações livres.

Usado pela ação "Atalho para outro programa" (bind), pelas ações de plugins que têm atalho
próprio (ex.: "Apertar para falar" do Discord) e pelos campos 'shortcut' das integrações.

Combinações geradas usam F13–F24, que não existem nos teclados comuns. Cada plugin pode dizer
quais combinações o programa dele aceita ("shortcut_rules" no plugin.json; o Discord, por
exemplo, não aceita Ctrl com F13–F24). Sem regras, a ordem é: primeiro as combinações com mais
modificadores (quase impossível colidir com algo), por último F13–F24 sozinhas (alguns softwares
de mouse e teclado gamer usam essas). Evita Win (o Windows intercepta) e Alt sozinho (ativa menus).
"""
from __future__ import annotations

from app import actions
from app.i18n import tr

MOD_ORDER = ["ctrl+shift+alt", "ctrl+shift", "ctrl+alt", "shift+alt", "ctrl", "shift", ""]
DEFAULT_RULES = {"keys": "f13-f24", "modifiers": MOD_ORDER}
ALL_COMBOS = [f"{m}+f{n}" if m else f"f{n}" for m in MOD_ORDER for n in range(13, 25)]

_MOD_RANK = {"ctrl": 0, "control": 0, "lctrl": 0, "rctrl": 0, "shift": 1, "lshift": 1, "rshift": 1,
             "alt": 2, "lalt": 2, "ralt": 2, "altgr": 2, "win": 3, "lwin": 3, "rwin": 3}
_MOD_NAME = {0: "ctrl", 1: "shift", 2: "alt", 3: "win"}


def canonical(combo: str) -> str:
    """'Shift+Ctrl+F13' -> 'ctrl+shift+f13' (para comparar combinações)."""
    parts = [p for p in str(combo).lower().replace(" ", "").split("+") if p]
    mods = sorted({_MOD_RANK[p] for p in parts if p in _MOD_RANK})
    rest = [p for p in parts if p not in _MOD_RANK]
    return "+".join([_MOD_NAME[m] for m in mods] + rest)


# -- regras de cada programa ---------------------------------------------------------------

def _expand_keys(keys) -> list[str]:
    """"f13-f24" ou ["f13", "f14-f16"] -> ["f13", ..., "f24"]."""
    out = []
    for item in ([keys] if isinstance(keys, str) else list(keys or [])):
        item = str(item).lower().strip()
        if "-" in item and item.count("f") == 2:
            a, b = item.split("-")
            out += [f"f{n}" for n in range(int(a[1:]), int(b[1:]) + 1)]
        elif item:
            out.append(item)
    return out


def combos_for(rules: dict | None) -> list[str]:
    """Combinações permitidas pelas regras, na ordem de preferência (modificador por modificador)."""
    rules = rules if isinstance(rules, dict) else DEFAULT_RULES
    mods = rules.get("modifiers", DEFAULT_RULES["modifiers"])
    keys = _expand_keys(rules.get("keys", DEFAULT_RULES["keys"]))
    return [f"{m}+{k}" if m else k for m in mods for k in keys]


def allowed(combo: str, rules: dict | None) -> bool:
    return canonical(combo) in {canonical(c) for c in combos_for(rules)}


def check_rules(rules) -> None:
    """Levanta ValueError se 'shortcut_rules' do plugin.json estiver mal escrito."""
    if not isinstance(rules, dict) or not combos_for(rules):
        raise ValueError("shortcut_rules")
    from app import keys
    for c in combos_for(rules):
        keys.parse_combo(c)


# -- onde cada atalho é usado ----------------------------------------------------------------
# Cada uso tem um "dono": dois usos com o mesmo dono podem dividir a combinação (duas teclas de
# "Apertar para falar" mandam o mesmo atalho de propósito); donos diferentes = sobreposição.

def _walk(spec, found: list, page, key, moment) -> None:
    spec = actions.normalize(spec)
    if not isinstance(spec, dict):
        return
    t = spec.get("type")
    d = actions.REGISTRY.get(t)
    if (t in ("bind", "hotkey") or (d is not None and d.mirror)) and spec.get("keys"):
        ks = spec["keys"] if isinstance(spec["keys"], list) else [spec["keys"]]
        for k in ks:
            # cada 'bind' é único; 'hotkey' só aperta teclas (vários podem repetir); as de plugin
            # (Discord) são donas pelo tipo da ação
            owner = f"bind:{page}:{key}:{moment}:{len(found)}" if t == "bind" else t
            found.append({"combo": canonical(k), "owner": owner, "page": str(page), "key": str(key), "type": t})
    if d and d.children:
        try:
            for child in d.children(spec):
                _walk(child, found, page, key, moment)
        except (KeyError, TypeError):
            pass


def usages(raw: dict) -> list[dict]:
    """Todos os atalhos do config: ações das teclas e campos 'shortcut' dos plugins ligados."""
    found: list = []
    for page, keys in (raw.get("pages") or {}).items():
        for key, spec in (keys or {}).items():
            if not isinstance(spec, dict):
                continue
            for moment in ("action", "double", "hold", "release"):
                _walk(spec.get(moment), found, page, key, moment)
    from app.plugins import MANAGER
    for combo, plugin, setting in MANAGER.shortcuts_in(raw):   # inclui os padrões que nem estão no config
        found.append({"combo": canonical(combo), "owner": f"{plugin}.{setting}", "plugin": plugin, "setting": setting})
    return found


def combos_in_config(raw: dict) -> set[str]:
    return {u["combo"] for u in usages(raw)}


def conflicts(raw: dict) -> list[dict]:
    """[{combo, places: [uso, ...]}] das combinações usadas por mais de um dono."""
    by: dict[str, list] = {}
    for u in usages(raw):
        by.setdefault(u["combo"], []).append(u)
    out = []
    for combo, us in by.items():
        if len({u["owner"] for u in us}) > 1:
            out.append({"combo": combo, "places": [{k: v for k, v in u.items() if k not in ("combo", "owner")} for u in us]})
    return out


def free_combos(raw: dict, count: int = 1, rules: dict | None = None, taken=()) -> list[str]:
    """Próximas combinações que as regras permitem e que ninguém usa (nem as já escolhidas em 'taken')."""
    used = combos_in_config(raw) | {canonical(c) for c in taken if c}
    out = []
    for combo in combos_for(rules):
        if canonical(combo) not in used:
            out.append(combo)
            used.add(canonical(combo))
            if len(out) == count:
                break
    if len(out) < count:
        raise ValueError(tr("no free shortcuts left ({n} in total)", n=len(combos_for(rules))))
    return out
