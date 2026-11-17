"""Registro de ações.

Uma ação é um dicionário com 'type' e parâmetros, ex.:
    {type: hotkey, keys: "ctrl+shift+m"}
Uma lista de ações é atalho para {type: multi, actions: [...]}.

Para criar uma ação nova:
    @action("nome", required=("campo",), state=lambda spec, key: "nome.do.estado")
    def minha_acao(spec, ctx): ...
'state' (opcional) diz qual estado a tecla deve refletir quando usa essa ação,
para trocar o ícone automaticamente (ex.: OBS gravando -> ícone ativo).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable
from app import logs
from app.i18n import tr

if TYPE_CHECKING:
    from app.engine import Engine

log = logs.get("actions")


@dataclass
class Context:
    engine: "Engine"
    page: str
    key: int
    moment: str = "press"  # press | double | hold | release | repeat | automation | test
    label: str | None = None  # nome da tecla (texto do ícone) ou da automação, para o log

    @property
    def key_id(self) -> str:
        return f"{self.page}:{self.key}"


@dataclass
class ActionDef:
    name: str
    fn: Callable[[dict, Context], Any]
    required: tuple[str, ...]
    state: Callable[[dict, str], str | None] | None
    children: Callable[[dict], list] | None
    check: Callable[[dict], list[str]] | None = None  # validação extra (lista de erros)
    plugin: str | None = None  # de qual plugin é (None = do app)
    mirror: bool = False  # ação principal da tecla: segura 'keys' enquanto a tecla do D6 estiver apertada


REGISTRY: dict[str, ActionDef] = {}


def action(name: str, required: tuple[str, ...] = (), state=None, children=None, check=None):
    def deco(fn):
        REGISTRY[name] = ActionDef(name, fn, tuple(required), state, children, check)
        return fn

    return deco


def normalize(spec) -> dict | None:
    if spec is None:
        return None
    if isinstance(spec, list):
        return {"type": "multi", "actions": spec}
    if isinstance(spec, str):
        # atalho: "page:obs", "hotkey:ctrl+c", "launch:notepad"
        kind, _, arg = spec.partition(":")
        field = {
            "page": "page",
            "hotkey": "keys",
            "launch": "target",
            "text": "text",
            "media": "key",
            "command": "command",
            "obs.scene": "scene",
        }.get(kind, "value")
        return {"type": kind, field: arg} if arg else {"type": kind}
    if isinstance(spec, dict) and (True in spec or False in spec):
        # YAML 1.1 lê as chaves 'on:'/'off:' como true/false; desfaz isso.
        spec = {("on" if k is True else "off" if k is False else k): v for k, v in spec.items()}
    return spec


def validate(spec, where: str) -> list[str]:
    spec = normalize(spec)
    if spec is None:
        return []
    if not isinstance(spec, dict) or "type" not in spec:
        return [tr("{where}: action needs 'type'", where=where)]
    d = REGISTRY.get(spec["type"])
    if d is None:
        if _from_missing_plugin(spec["type"]):
            return []  # ação de um plugin que não está instalado: a tecla só não faz nada
        return [
            tr(
                "{where}: unknown action type '{type}'. Known: {known}",
                where=where,
                type=spec["type"],
                known=", ".join(sorted(REGISTRY)),
            )
        ]
    errors = [
        tr("{where}: action '{action}' needs the field '{field}'", where=where, action=d.name, field=f)
        for f in d.required
        if f not in spec
    ]
    if d.check and not errors:
        errors += [f"{where}: {msg}" for msg in d.check(spec)]
    if d.children and not errors:
        for i, child in enumerate(d.children(spec)):
            errors += validate(child, f"{where} > {d.name}[{i}]")
    return errors


def _from_missing_plugin(type_name) -> bool:
    """'pomodoro.toggle' com o plugin 'pomodoro' removido (ações do app não têm ponto no nome)."""
    if not isinstance(type_name, str) or "." not in type_name:
        return False
    prefix = type_name.split(".", 1)[0]
    return not any(n.split(".", 1)[0] == prefix for n in REGISTRY)


def state_of(spec, key_id: str) -> str | None:
    spec = normalize(spec)
    if not spec:
        return None
    d = REGISTRY.get(spec.get("type"))
    return d.state(spec, key_id) if d and d.state else None


def _where(ctx: Context) -> str:
    """'key 3 (page obs)' ou "automation 'Live'" para as mensagens do log."""
    if not ctx.key:
        return f"automation '{ctx.label}'" if ctx.label else "automation"
    return f"key {ctx.key} (page {ctx.page})"


def _info(spec: dict, ctx: Context) -> dict:
    return {
        "action": spec.get("type"),
        "label": ctx.label,
        "key": ctx.key or None,
        "page": ctx.page,
        "moment": ctx.moment,
        "params": {k: v for k, v in spec.items() if k != "type"},
    }


def run(spec, ctx: Context) -> None:
    spec = normalize(spec)
    if not spec:
        return
    d = REGISTRY.get(spec["type"])
    if d is None:
        log.warning(
            "%s on %s: the plugin of this action isn't installed",
            spec.get("type"),
            _where(ctx),
            extra={"ctx": _info(spec, ctx)},
        )
        return
    t0 = time.perf_counter()
    try:
        if d.plugin:
            from app.plugins import run_guard

            run_guard(d)
        d.fn(spec, ctx)
    except Exception as e:  # uma ação com erro não derruba o app
        info = _info(spec, ctx)
        info["ms"] = round((time.perf_counter() - t0) * 1000)
        log.error("%s failed on %s: %s", d.name, _where(ctx), e, exc_info=True, extra={"ctx": info})
        try:
            ctx.engine.action_failed(ctx.key, ctx.page)
        except Exception:
            log.debug("Couldn't show the error mark on %s", _where(ctx), exc_info=True)
        return
    log.debug("%s ran on %s (%s) in %d ms", d.name, _where(ctx), ctx.moment, round((time.perf_counter() - t0) * 1000))


# registra as ações do app e as dos plugins (OBS, Discord e os de terceiros)
from app.actions import basic  # noqa: E402,F401
from app.plugins import MANAGER  # noqa: E402

MANAGER.load()
