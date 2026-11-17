"""Plugins: integrações que acrescentam ações, configurações e estados ao app.

Cada plugin é uma pasta com um plugin.json (ver PLUGINS.md). Dois tipos:
  * embutidos (app/plugins/builtin/<id>): Python, rodam dentro do app (OBS, Discord);
  * de terceiros (pasta 'plugins' nos dados do app): um programa separado, em qualquer linguagem,
    que conversa com o app por linhas de JSON no stdin/stdout (app/plugins/external.py).
    Se o programa travar ou cair, o app continua.

Este módulo descobre os plugins, registra as ações deles no registro de ações
(app.actions.REGISTRY), liga/desliga cada um conforme o config e informa o estado
(conectado, esperando...) para o editor.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import shutil
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app import actions
from app import i18n
from app import logs
from app import paths
from app.errors import PluginError  # mora em app/errors.py; continua importável daqui
from app.i18n import tr
from app.values import VALUES, Values

if TYPE_CHECKING:
    from app.engine import Engine

log = logs.get("plugins")
BUILTIN_DIR = paths.BUILTIN_PLUGINS
ID_RE = re.compile(r"^[a-z][a-z0-9_-]{1,39}$")
SETTING_KINDS = ("text", "password", "number", "bool", "enum", "shortcut")


def user_dir() -> Path:
    from app import winutil

    d = winutil.data_dir() / "plugins"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------------------- manifesto


@dataclass
class Plugin:
    id: str
    path: Path
    manifest: dict
    builtin: bool
    instance: Any = None  # objeto vivo (embutido: o que setup() devolve; externo: ExternalPlugin)
    running: bool = False
    error: str | None = None
    locales: dict = field(default_factory=dict)
    status: dict = field(default_factory=lambda: {"state": "off", "label": tr("Off")})

    @property
    def name(self) -> str:
        return self.text().get("name") or self.id

    def text(self, lang: str | None = None) -> dict:
        """O manifesto com os textos no idioma atual."""
        lang = lang or i18n.language()
        cache = self.__dict__.setdefault("_text", {})
        if lang not in cache:
            cache[lang] = localize(self.manifest, self.locales, lang)
        return cache[lang]

    @property
    def config_path(self) -> list[str]:
        # embutidos guardam a config numa seção própria (obs:, discord:); terceiros em plugins: <id>:
        key = self.manifest.get("config_key") if self.builtin else None
        return [key] if key else ["plugins", self.id]

    def settings_from(self, cfg: dict) -> dict | None:
        node: Any = cfg
        for k in self.config_path:
            node = node.get(k) if isinstance(node, dict) else None
        return node if isinstance(node, dict) else None

    def enabled_in(self, cfg: dict) -> bool:
        s = self.settings_from(cfg)
        if s is None:
            return bool(self.manifest.get("default_enabled", False))
        return s.get("enabled", True) is not False

    def effective_settings(self, cfg: dict) -> dict:
        out = {s["name"]: s.get("default") for s in self.manifest.get("settings", []) if "default" in s}
        out.update({k: v for k, v in (self.settings_from(cfg) or {}).items() if k != "enabled"})
        return out


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

    return text(m)


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


# ---------------------------------------------------------------------------- API dos plugins embutidos


class PluginAPI:
    """O que um plugin embutido recebe em setup(api)."""

    def __init__(self, manager: "PluginManager", plugin: Plugin):
        self._m, self._p = manager, plugin

    @property
    def engine(self) -> "Engine | None":
        return self._m.engine

    def action(self, name: str, required: tuple[str, ...] = (), state=None, children=None, check=None, mirror=False):
        """Decorador igual ao app.actions.action, marcando a ação como deste plugin.
        mirror=True: como ação principal da tecla, o app segura spec['keys'] enquanto a tecla do D6
        estiver apertada (apertar para falar); em sequências e no 'hold' é um toque simples."""

        def deco(fn):
            actions.REGISTRY[name] = actions.ActionDef(
                name, fn, tuple(required), state, children, check, plugin=self._p.id, mirror=mirror
            )
            return fn

        return deco

    def set_status(self, state: str, label: str) -> None:
        """state: ok | wait | error | off. label: o que aparece no editor (ex.: 'Conectado')."""
        self._p.status = {"state": state, "label": label}

    def set_value(self, name: str, value) -> None:
        """Publica um valor (texto, número, sim/não, nome de ícone, caminho de imagem) que teclas,
        regras e automações podem usar. O nome deve começar com '<id do plugin>.'."""
        if not str(name).startswith(self._p.id + "."):
            logs.get(f"plugins.{self._p.id}").warning("Value '%s' ignored: it must start with '%s.'", name, self._p.id)
            return
        self._m.values.set(str(name), value)


# ---------------------------------------------------------------------------- gerenciador


class PluginManager:
    def __init__(self, values: Values):
        self.values = values  # onde os plugins publicam os valores deles
        self.plugins: dict[str, Plugin] = {}
        self.errors: list[dict] = []  # pastas que não carregaram: {folder, error}
        self.engine: "Engine | None" = None
        self._cfg: dict = {}
        self._lock = threading.RLock()

    # -- descoberta
    def load(self) -> None:
        with self._lock:
            self._unregister_all()
            self.plugins, self.errors = {}, []
            folders = [(p, True) for p in sorted(BUILTIN_DIR.iterdir()) if p.is_dir() and not p.name.startswith("_")]
            try:
                folders += [(p, False) for p in sorted(user_dir().iterdir()) if p.is_dir()]
            except OSError:
                pass
            for folder, builtin in folders:
                try:
                    m = read_manifest(folder, builtin)
                    if m["id"] in self.plugins:
                        raise PluginError(tr("there's already a plugin with the id '{id}'", id=m["id"]))
                    p = Plugin(m["id"], folder, m, builtin, locales=read_locales(folder))
                    for miss in missing_keys(m, p.locales)[:5]:
                        log.warning("Plugin %s: missing translation %s", m["id"], miss)
                    self._register(p)
                    self.plugins[p.id] = p
                except Exception as e:  # um plugin com defeito não impede os outros
                    self.errors.append({"folder": folder.name, "error": str(e)})
                    log.error(
                        "Plugin in folder %s didn't load: %s",
                        folder.name,
                        e,
                        exc_info=not isinstance(e, PluginError),
                        extra={"ctx": {"folder": str(folder), "builtin": builtin}},
                    )
            log.info(
                "Plugins found: %s",
                ", ".join(
                    f"{p.id} {p.manifest.get('version') or '?'}{' (built-in)' if p.builtin else ''}"
                    for p in self.plugins.values()
                )
                or "none",
            )

    def _register(self, p: Plugin) -> None:
        if p.builtin:
            # como pacote: o plugin pode ter outros arquivos e importar com "from .rpc import ..."
            spec = importlib.util.spec_from_file_location(
                f"d6plugin_{p.id}", p.path / p.manifest["entry"], submodule_search_locations=[str(p.path)]
            )
            mod = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = mod
            spec.loader.exec_module(mod)
            p.instance = mod.setup(PluginAPI(self, p))
        else:
            from app.plugins.external import ExternalPlugin

            p.instance = ExternalPlugin(self, p)
            for name, d in p.manifest.get("actions", {}).items():
                fields = d.get("fields") or []
                required = tuple(f["name"] for f in fields if isinstance(f, dict) and f.get("required"))
                state = (lambda s, k, st=d.get("state"): st) if isinstance(d.get("state"), str) else None  # noqa: B008 (guarda o valor desta volta)
                actions.REGISTRY[name] = actions.ActionDef(
                    name, p.instance.make_action(name), required, state, None, plugin=p.id, mirror=bool(d.get("mirror"))
                )

    def _unregister_all(self) -> None:
        for name in [n for n, d in actions.REGISTRY.items() if d.plugin]:
            del actions.REGISTRY[name]
        for p in self.plugins.values():
            self._stop(p)

    def reload(self) -> None:
        """Depois de instalar ou remover um plugin: carrega tudo de novo e religa o que estava ligado."""
        with self._lock:
            self.load()
            if self.engine is not None:
                self.sync(self._cfg)

    # -- liga/desliga conforme o config
    def attach(self, engine: "Engine") -> None:
        self.engine = engine

    def sync(self, cfg: dict) -> None:
        with self._lock:
            self._cfg = cfg or {}
            for p in self.plugins.values():
                on = p.enabled_in(self._cfg)
                settings = p.effective_settings(self._cfg)
                try:
                    if on and not p.running:
                        p.error = None
                        if hasattr(p.instance, "start"):
                            p.instance.start(settings)
                        p.running = True
                        if p.status.get("state") == "off":
                            p.status = {"state": "ok", "label": tr("On")}
                        log.info(
                            "Plugin started: %s %s%s",
                            p.id,
                            p.manifest.get("version") or "?",
                            " (built-in)" if p.builtin else "",
                        )
                    elif on and p.running:
                        if hasattr(p.instance, "update"):
                            p.instance.update(settings)
                        if hasattr(p.instance, "set_locale"):  # o idioma mudou no editor
                            p.instance.set_locale(i18n.language())
                    elif not on and p.running:
                        self._stop(p)
                except Exception as e:
                    p.error = str(e)
                    p.status = {"state": "error", "label": tr("Didn't start")}
                    log.error(
                        "Plugin %s didn't start: %s",
                        p.id,
                        e,
                        exc_info=True,
                        extra={"ctx": {"plugin": p.id, "version": p.manifest.get("version")}},
                    )

    def _stop(self, p: Plugin) -> None:
        was = p.running
        if p.running and hasattr(p.instance, "stop"):
            try:
                p.instance.stop()
            except Exception as e:
                log.warning(
                    "Plugin %s failed while stopping: %s", p.id, e, exc_info=True, extra={"ctx": {"plugin": p.id}}
                )
        if was:
            log.info("Plugin stopped: %s", p.id)
        logs.resolve_prefix(f"plugin.{p.id}.")  # desligado: os problemas dele deixam de valer
        p.running = False
        p.status = {"state": "off", "label": tr("Off")}
        self.values.forget_prefix(p.id + ".")  # desligado: as teclas mostram "–"

    def stop_all(self) -> None:
        with self._lock:
            for p in self.plugins.values():
                self._stop(p)

    def is_running(self, plugin_id: str) -> bool:
        p = self.plugins.get(plugin_id)
        return bool(p and p.running)

    def instance(self, plugin_id: str):
        p = self.plugins.get(plugin_id)
        return p.instance if p and p.running else None

    # -- para o editor
    def status(self) -> dict:
        for p in self.plugins.values():
            if p.running and hasattr(p.instance, "current_status"):
                try:
                    p.status = p.instance.current_status()
                except Exception as e:
                    if p.error != str(e):  # o editor pergunta toda hora: avisa só quando o erro muda
                        log.warning("Plugin %s: couldn't read its status: %s", p.id, e, exc_info=True)
                    p.status = {"state": "error", "label": tr("Error")}
                    p.error = str(e)
        return {pid: {**p.status, "error": p.error or p.status.get("detail")} for pid, p in self.plugins.items()}

    def describe(self) -> list[dict]:
        out = []
        ordered = sorted(
            self.plugins.values(), key=lambda p: (not p.builtin, p.manifest.get("order", 99), p.name.lower())
        )
        for p in ordered:
            m = p.text()
            out.append(
                {
                    k: m.get(k)
                    for k in (
                        "id",
                        "name",
                        "version",
                        "author",
                        "description",
                        "icon",
                        "color",
                        "category",
                        "settings",
                        "steps",
                        "states",
                        "permissions",
                        "homepage",
                        "shortcut_rules",
                    )
                }
                | {
                    "builtin": p.builtin,
                    "config_path": p.config_path,
                    "default_enabled": bool(m.get("default_enabled", False)),
                }
            )
        return out

    def value_schemas(self) -> list[dict]:
        """Valores dos plugins (os declarados em 'values' e os estados, como sim/não) para o editor."""
        out = []
        for p in self.plugins.values():
            m = p.text()
            group = m.get("category") or p.name
            for v in m.get("values", []) or []:
                out.append(
                    {
                        "id": v["id"],
                        "label": v.get("label") or v["id"],
                        "group": group,
                        "kind": v.get("kind", "text"),
                        "sample": v.get("sample"),
                        "plugin": p.id,
                    }
                )
            for st in m.get("states", []) or []:
                if not any(o["id"] == st[0] for o in out):
                    out.append(
                        {"id": st[0], "label": st[1], "group": group, "kind": "bool", "sample": False, "plugin": p.id}
                    )
        return out

    def widget_schemas(self) -> dict:
        """Widgets dos plugins ligados, já no formato do editor (ver app/widgets.py)."""
        from app import widgets

        out = {}
        for p in self.plugins.values():
            m = p.text()
            for name, wd in (m.get("widgets") or {}).items():
                out[name] = widgets.normalize(
                    {**wd, "icon": wd.get("icon") or m.get("icon")}, plugin=p.id, color=m.get("color")
                )
        return out

    def action_schemas(self) -> dict:
        out = {}
        for p in self.plugins.values():
            m = p.text()
            for name, d in m.get("actions", {}).items():
                out[name] = {
                    "label": d["label"],
                    "group": m.get("category") or m["name"],
                    "help": d.get("help", ""),
                    "state": bool(d.get("state")),
                    "fields": d.get("fields") or [],
                    "icon": d.get("icon"),
                    "short": d.get("short"),
                    "plugin": p.id,
                    "shortcut_rules": d.get("shortcut_rules") or m.get("shortcut_rules"),
                }
        return out

    def shortcuts_in(self, cfg: dict) -> list[tuple[str, str, str]]:
        """[(combinação, id do plugin, nome da configuração)] dos campos 'shortcut' dos plugins ligados."""
        out = []
        for p in self.plugins.values():
            if not p.enabled_in(cfg):
                continue
            values = p.effective_settings(cfg)
            for s in p.manifest.get("settings", []):
                v = values.get(s["name"])
                if s.get("kind") == "shortcut" and isinstance(v, str) and v.strip():
                    out.append((v, p.id, s["name"]))
        return out

    def secret_paths(self) -> list[tuple]:
        """Onde ficam as senhas no config (configurações 'password' de todos os plugins)."""
        return [
            (*p.config_path, s["name"])
            for p in self.plugins.values()
            for s in p.manifest.get("settings", [])
            if s.get("kind") == "password"
        ]

    def secret_values(self, cfg: dict) -> list[str]:
        """Os valores atuais dessas senhas (para o log escondê-las)."""
        out = []
        for path in self.secret_paths():
            node: Any = cfg
            for k in path:
                node = node.get(k) if isinstance(node, dict) else None
            if isinstance(node, (str, int)) and not isinstance(node, bool) and str(node):
                out.append(str(node))
        return out

    def groups(self) -> dict:
        return {
            (p.text().get("category") or p.name): {
                "color": p.manifest.get("color", "#868d99"),
                "icon": p.manifest.get("icon"),
            }
            for p in self.plugins.values()
        }

    # -- instalar e remover (só os de terceiros)
    def install(self, folder: Path, replace: bool = False) -> Plugin:
        m = read_manifest(folder, builtin=False)
        if m["id"] in self.plugins and self.plugins[m["id"]].builtin:
            raise PluginError(tr("'{id}' is a built-in plugin of the app", id=m["id"]))
        dest = user_dir() / m["id"]
        if dest.exists():
            if not replace:
                raise PluginError(tr("the plugin '{id}' is already installed", id=m["id"]))
            with self._lock:
                if m["id"] in self.plugins:
                    self._stop(self.plugins[m["id"]])
            shutil.rmtree(dest)
        shutil.copytree(folder, dest)
        self.reload()
        return self.plugins[m["id"]]

    def remove(self, plugin_id: str) -> None:
        p = self.plugins.get(plugin_id)
        if p is None:
            raise PluginError(tr("plugin not found"))
        if p.builtin:
            raise PluginError(tr("built-in plugins can't be removed; turn them off in Integrations"))
        with self._lock:
            self._stop(p)
        shutil.rmtree(p.path)
        self.reload()


MANAGER = PluginManager(VALUES)  # o app usa o que o app/bootstrap.py entrega (é este mesmo)


def run_guard(d: "actions.ActionDef") -> None:
    """Chamado antes de rodar uma ação: plugin desligado não roda."""
    if d.plugin and not MANAGER.is_running(d.plugin):
        p = MANAGER.plugins.get(d.plugin)
        raise RuntimeError(
            tr("the '{name}' integration is turned off (Settings › Integrations)", name=p.name if p else d.plugin)
        )
