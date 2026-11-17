"""O objeto que cada plugin embutido recebe em setup(api): a porta dele para o app."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app import actions
from app import logs

if TYPE_CHECKING:
    from app.engine import Engine
    from app.plugins.manager import Plugin, PluginManager


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
