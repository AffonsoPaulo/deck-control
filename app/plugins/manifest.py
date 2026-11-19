"""O plugin.json: ler, validar e traduzir.

Só regras sobre o arquivo e os textos dele; nada aqui liga plugin nem mexe no registro de ações.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app import i18n
from app import logs
from app.errors import PluginError
from app.i18n import tr

# como o plugin de terceiros roda (runtime_of, python_run, parse_run) mora em app/plugin_runner.py, com o modo
# --run-plugin, que usa isso sem carregar o resto do app
from app.plugin_runner import RUNTIMES, parse_run, python_run

log = logs.get("plugins")
ID_RE = re.compile(r"^[a-z][a-z0-9_-]{1,39}$")
SETTING_KINDS = ("text", "password", "number", "bool", "enum", "shortcut")
PROTOCOL = 1  # a versão do protocolo (app/plugins/external.py) que este app fala; o "protocol" do manifesto pede


# ---------------------------------------------------------------------------- idiomas
# Textos do plugin.json podem ser "%chave%": a tradução vem de locales/<idioma>.json na pasta
# do plugin. Ordem de busca: idioma exato (pt-BR) -> idioma base (pt) -> default_locale -> a chave.
# Texto comum (sem %) continua valendo, para plugins que só falam uma língua.

_KEY = re.compile(r"^%([A-Za-z0-9_.\-]+)%$")
_FIXED = {
    "id",
    "name",
    "kind",
    "entry",
    "run",
    "config_key",
    "default",
    "state",
    "icon",
    "color",
    "version",
    "homepage",
    "default_locale",
    "placeholder",
    "when",
    "style",
}


def read_locales(folder: Path) -> dict[str, dict]:
    out = {}
    try:
        files = sorted((folder / "locales").glob("*.json"))
    except OSError:
        files = []
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(d, dict):
                out[f.stem] = {k: v for k, v in d.items() if isinstance(v, str)}
        except (OSError, ValueError) as e:
            log.warning("Plugin %s: couldn't read locales/%s: %s", folder.name, f.name, e)
    return out


def localize(m: dict, locales: dict[str, dict], lang: str | None = None):
    """Cópia do manifesto com os "%chave%" trocados pelo texto do idioma."""
    lang = lang or i18n.language()
    chain = [lang, lang.split("-")[0], m.get("default_locale") or "en"]
    tables = [locales[c] for c in dict.fromkeys(chain) if c in locales]

    def text(v):
        if isinstance(v, str):
            k = _KEY.match(v)
            if not k:
                return v
            return next((t[k.group(1)] for t in tables if k.group(1) in t), k.group(1))
        if isinstance(v, list):
            return [text(x) for x in v]
        if isinstance(v, dict):
            return {k: (x if k in _FIXED else text(x)) for k, x in v.items()}
        return v

    out = text(m)
    # o nome do plugin pode ser traduzido ("name": "%name%"); dentro de settings e actions, "name" é identificador
    if isinstance(out, dict) and isinstance(m.get("name"), str):
        out["name"] = text(m["name"])
    return out


def missing_keys(m: dict, locales: dict[str, dict]) -> list[str]:
    """Chaves usadas no plugin.json que faltam em algum dos arquivos de idioma."""
    used = set()

    def walk(v):
        if isinstance(v, str) and _KEY.match(v):
            used.add(_KEY.match(v).group(1))
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)

    walk(m)
    return [f"{lang}: {k}" for lang, t in sorted(locales.items()) for k in sorted(used - set(t))]


# ---------------------------------------------------------------------------- manifesto


def read_manifest(folder: Path, builtin: bool) -> dict:
    try:
        m = json.loads((folder / "plugin.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise PluginError(tr("plugin.json is missing")) from None
    except (OSError, ValueError) as e:
        raise PluginError(tr("invalid plugin.json: {error}", error=e)) from None
    check_manifest(m, builtin)
    return m


def check_manifest(m: dict, builtin: bool) -> None:
    if not isinstance(m, dict):
        raise PluginError(tr("plugin.json must be an object"))
    pid = m.get("id")
    if not isinstance(pid, str) or not ID_RE.match(pid):
        raise PluginError(tr("'id' must have 2 to 40 lowercase letters, numbers, - or _, starting with a letter"))
    if not isinstance(m.get("name"), str) or not m["name"].strip():
        raise PluginError(tr("'name' is missing"))
    if builtin:
        if not m.get("entry"):
            raise PluginError(tr("a built-in plugin needs 'entry'"))
    else:
        run = m.get("run")
        if not (isinstance(run, list) and run and all(isinstance(x, str) for x in run)):
            raise PluginError(tr('\'run\' must be the plugin\'s command line, as a list (e.g.: ["python", "main.py"])'))
        if m.get("config_key"):
            raise PluginError(tr("'config_key' is only for built-in plugins"))
        check_runtime(m)
    acts = m.get("actions", {})
    if not isinstance(acts, dict):
        raise PluginError(tr("'actions' must be an object (action type: description)"))
    for name, d in acts.items():
        if not builtin and not name.startswith(pid + "."):
            raise PluginError(tr("the action '{name}' must start with '{prefix}.'", name=name, prefix=pid))
        if not isinstance(d, dict) or not d.get("label"):
            raise PluginError(tr("the action '{name}' needs a 'label'", name=name))
    for s in m.get("settings", []):
        if not isinstance(s, dict) or not s.get("name") or s.get("kind", "text") not in SETTING_KINDS:
            raise PluginError(
                tr("invalid setting: {setting} (kind: {kinds})", setting=repr(s), kinds=", ".join(SETTING_KINDS))
            )
        if s["name"] == "enabled":
            raise PluginError(tr("'enabled' is reserved (the plugin on/off switch)"))
    for st in m.get("states", []):
        if not (isinstance(st, list) and len(st) == 2):
            raise PluginError(tr("'states' must be a list of [name, description]"))
        if not builtin and not str(st[0]).startswith(pid + "."):
            raise PluginError(tr("the state '{name}' must start with '{prefix}.'", name=st[0], prefix=pid))
    for v in m.get("values", []) or []:
        if not isinstance(v, dict) or not str(v.get("id", "")).startswith(pid + "."):
            raise PluginError(tr("each value needs an 'id' starting with '{prefix}.'", prefix=pid))
    wids = m.get("widgets", {}) or {}
    if not isinstance(wids, dict):
        raise PluginError(tr("'widgets' must be an object (widget id: description)"))
    from app import widgets

    for name, wd in wids.items():
        if not str(name).startswith(pid + "."):
            raise PluginError(tr("the widget '{name}' must start with '{prefix}.'", name=name, prefix=pid))
        problem = widgets.check(str(name), wd)
        if problem:
            raise PluginError(problem)
        if isinstance(wd, dict) and wd.get("category") not in (None, *widgets.CATEGORY_IDS):
            raise PluginError(
                tr(
                    "the widget '{name}': 'category' must be one of {cats}",
                    name=name,
                    cats=", ".join(widgets.CATEGORY_IDS),
                )
            )
    from app.binds import check_rules

    rule_sets = [m["shortcut_rules"]] if "shortcut_rules" in m else []
    rule_sets += [
        d["shortcut_rules"] for d in m.get("actions", {}).values() if isinstance(d, dict) and "shortcut_rules" in d
    ]
    for rules in rule_sets:
        try:
            check_rules(rules)
        except ValueError:
            raise PluginError(
                tr("invalid 'shortcut_rules': use {example}", example='{"keys": "f13-f24", "modifiers": ["", "shift"]}')
            ) from None


def check_runtime(m: dict[str, Any]) -> None:
    """O "runtime" e o "protocol" de um plugin de terceiros. Os dois são opcionais: sem eles, vale o de sempre."""
    rt = m.get("runtime")
    if rt is not None and rt not in RUNTIMES:
        raise PluginError(tr('\'runtime\' must be "exe" or "deck-python"'))
    need = m.get("protocol", 1)
    if not isinstance(need, int) or isinstance(need, bool) or need < 1:
        raise PluginError(tr("'protocol' must be a whole number: the version of the plugin protocol (e.g.: 1)"))
    if need > PROTOCOL:
        raise PluginError(
            tr(
                "this plugin needs version {need} of the plugin protocol, and this Deck only has version {have}. "
                "Update the Deck to use it.",
                need=need,
                have=PROTOCOL,
            )
        )
    if rt == "deck-python":
        parse_run(python_run(m))  # confere o script (ou -m módulo) e as opções do Python
