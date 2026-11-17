"""O gerenciador dos plugins: descobre, carrega, liga e desliga cada um, e informa o estado para o editor."""

from __future__ import annotations

import importlib.util
import shutil
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app import actions
from app import i18n
from app import logs
from app import paths
from app.errors import PluginError
from app.i18n import tr
from app.plugins.api import PluginAPI
from app.plugin_runner import runtime_of
from app.plugins.manifest import localize, missing_keys, read_locales, read_manifest
from app.values import VALUES, Values

if TYPE_CHECKING:
    from app.engine import Engine

log = logs.get("plugins")
BUILTIN_DIR = paths.BUILTIN_PLUGINS


def user_dir() -> Path:
    from app import winutil

    d = winutil.data_dir() / "plugins"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------------------- plugin


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


# ---------------------------------------------------------------------------- gerenciador


class PluginManager:
    """Os plugins do app e o ciclo de vida de cada um:

        carregar (load)   ler e validar o plugin.json e registrar as ações. Embutido: importa o plugin.py e chama
                          setup(api), que registra as ações e devolve a instância. De terceiros: cria o
                          ExternalPlugin (o processo ainda não abre) e registra as ações do manifesto.
        ligar (start)     o config liga o plugin: instance.start(settings). O de terceiros abre o processo e
                          manda o "hello".
        atualizar         continua ligado e o config foi lido de novo: instance.update(settings) e
                          instance.set_locale(idioma).
        desligar (stop)   instance.stop(); os valores e os problemas do plugin somem e o status volta a "Off".

    Cada método da instância é opcional (o app só chama o que existe; ver PluginHooks em api.py). Só o carregar
    registra ações: um plugin desligado continua com as ações no editor, e o run_guard barra quando uma tecla
    tenta rodar. O carregar roda no bootstrap e depois de instalar ou remover um plugin; ligar, atualizar e
    desligar, a cada leitura do config (sync) e ao fechar o app (stop_all).
    """

    def __init__(self, values: Values):
        self.values = values  # onde os plugins publicam os valores deles
        self.plugins: dict[str, Plugin] = {}
        self.errors: list[dict] = []  # pastas que não carregaram: {folder, error}
        self.engine: "Engine | None" = None
        self._cfg: dict = {}
        self._lock = threading.RLock()

    # -- carregar
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
                    p = self._load_one(folder, builtin)
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

    def _load_one(self, folder: Path, builtin: bool) -> Plugin:
        """Lê e valida o manifesto da pasta e registra as ações do plugin (que continua desligado)."""
        m = read_manifest(folder, builtin)
        if m["id"] in self.plugins:
            raise PluginError(tr("there's already a plugin with the id '{id}'", id=m["id"]))
        p = Plugin(m["id"], folder, m, builtin, locales=read_locales(folder))
        for miss in missing_keys(m, p.locales)[:5]:
            log.warning("Plugin %s: missing translation %s", m["id"], miss)
        self._register(p)
        return p

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

    # -- ligar, atualizar e desligar conforme o config
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
                        self._start(p, settings)
                    elif on and p.running:
                        self._update(p, settings)
                    elif not on and p.running:
                        self._stop(p)
                except Exception as e:  # inclusive ao atualizar: o status vira "Didn't start" (como sempre foi)
                    p.error = str(e)
                    p.status = {"state": "error", "label": tr("Didn't start")}
                    log.error(
                        "Plugin %s didn't start: %s",
                        p.id,
                        e,
                        exc_info=True,
                        extra={"ctx": {"plugin": p.id, "version": p.manifest.get("version")}},
                    )

    def _start(self, p: Plugin, settings: dict) -> None:
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

    def _update(self, p: Plugin, settings: dict) -> None:
        if hasattr(p.instance, "update"):
            p.instance.update(settings)
        if hasattr(p.instance, "set_locale"):  # o idioma mudou no editor
            p.instance.set_locale(i18n.language())

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
        p = self.plugins[m["id"]]
        # o registro de onde veio e do que vai rodar no PC (o editor mostrou e a pessoa confirmou antes)
        log.info(
            "Plugin installed: %s %s by %s (homepage: %s); runtime %s, runs %s",
            p.id,
            m.get("version") or "?",
            p.text().get("author") or "?",
            m.get("homepage") or "none",
            runtime_of(m),
            m.get("run"),
            extra={"ctx": {"plugin": p.id, "folder": str(dest), "replaced": replace}},
        )
        return p

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
