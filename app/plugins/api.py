"""A porta de cada plugin para o app: o PluginAPI, que o embutido recebe em setup(api), e o que ele devolve.

O plugin fala com o app só por aqui (registrar ações, publicar valores e estados, mostrar o status, escrever no
log), sem procurar o gerenciador, os valores ou o engine globais. O de terceiros usa o mesmo objeto por dentro:
o ExternalPlugin traduz as mensagens do protocolo em chamadas a ele.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from app import actions
from app import i18n
from app import logs

if TYPE_CHECKING:
    from app.engine import Engine
    from app.plugins.manager import Plugin, PluginManager

Spec = dict[str, Any]  # a ação como está no config: {"type": "obs.scene", "scene": "Jogo"}
ActionFn = Callable[[Spec, actions.Context], Any]


class PluginHooks(Protocol):
    """O que setup(api) devolve (e o ExternalPlugin implementa). Todos os métodos são opcionais: o app só chama
    os que existem.

        start(settings)     ligar: o config ligou o plugin (settings: as configurações, com os padrões)
        update(settings)    o config foi lido de novo com o plugin ligado (pode ser igual ao anterior)
        set_locale(idioma)  junto com o update: o idioma do app ("pt-BR" ou "en"), que pode ter mudado
        stop()              desligar: o config desligou o plugin, ou o app vai fechar
        current_status()    {"state": "ok|wait|error", "label": "...", "detail": "..."} para as Integrações
    """

    def start(self, settings: dict[str, Any]) -> None: ...
    def update(self, settings: dict[str, Any]) -> None: ...
    def set_locale(self, locale: str) -> None: ...
    def stop(self) -> None: ...
    def current_status(self) -> dict[str, Any]: ...


class PluginAPI:
    """O que um plugin embutido recebe em setup(api)."""

    def __init__(self, manager: "PluginManager", plugin: Plugin):
        self._m, self._p = manager, plugin

    @property
    def id(self) -> str:
        return self._p.id

    @property
    def folder(self) -> Path:
        """A pasta do plugin (para ler os arquivos que ele traz)."""
        return self._p.path

    @property
    def log(self) -> logging.Logger:
        """O log do plugin (deck.plugins.<id>). Em inglês; senhas passam pelo logs.mask."""
        return logs.get(f"plugins.{self._p.id}")

    @property
    def engine(self) -> "Engine | None":
        return self._m.engine

    def language(self) -> str:
        """O idioma do app agora: "pt-BR" ou "en"."""
        return i18n.language()

    def action(
        self,
        name: str,
        required: tuple[str, ...] = (),
        state: Callable[[Spec, str], str | None] | None = None,
        children: Callable[[Spec], list[Any]] | None = None,
        check: Callable[[Spec], list[str]] | None = None,
        mirror: bool = False,
    ) -> Callable[[ActionFn], ActionFn]:
        """Decorador igual ao app.actions.action, marcando a ação como deste plugin.
        mirror=True: como ação principal da tecla, o app segura spec['keys'] enquanto a tecla do D6
        estiver apertada (apertar para falar); em sequências e no 'hold' é um toque simples."""

        def deco(fn: ActionFn) -> ActionFn:
            actions.REGISTRY[name] = actions.ActionDef(
                name, fn, tuple(required), state, children, check, plugin=self._p.id, mirror=mirror
            )
            return fn

        return deco

    def set_status(self, state: str, label: str) -> None:
        """state: ok | wait | error | off. label: o que aparece no editor (ex.: 'Conectado')."""
        self._p.status = {"state": state, "label": label}

    def set_value(self, name: str, value: Any) -> None:
        """Publica um valor (texto, número, sim/não, nome de ícone, caminho de imagem) que teclas,
        regras e automações podem usar. O nome deve começar com '<id do plugin>.'."""
        if not str(name).startswith(self._p.id + "."):
            logs.get(f"plugins.{self._p.id}").warning("Value '%s' ignored: it must start with '%s.'", name, self._p.id)
            return
        self._m.values.set(str(name), value)

    def set_state(self, name: str, value: Any) -> None:
        """Liga/desliga um estado (troca o ícone das teclas que usam). O nome deve começar com '<id do plugin>.'.
        Antes de o engine existir (o app ainda abrindo), não faz nada."""
        if not str(name).startswith(self._p.id + "."):
            logs.get(f"plugins.{self._p.id}").warning("State '%s' ignored: it must start with '%s.'", name, self._p.id)
            return
        eng = self._m.engine
        if eng is not None:
            eng.set_state(str(name), bool(value))
