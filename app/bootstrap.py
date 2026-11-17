"""Montagem do app (composition root): o único lugar que carrega os plugins e entrega as peças compartilhadas.

Importar um módulo do app não liga nada; quem precisa das peças chama `services()`:
- `python -m app` (todas as formas, inclusive `--check`), antes de ler o config;
- o servidor do editor de teste, os testes e as ferramentas.

Sem `services()`, um config válido falha com "unknown action type 'obs.…'": as ações dos plugins só existem
depois que os plugins carregam.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

from app import actions  # noqa: F401  (registra as ações do app: os decoradores de app/actions/basic.py)
from app.plugins import MANAGER, PluginManager
from app.values import Values


@dataclass(frozen=True, slots=True)
class Services:
    """As peças que existem uma vez só por processo."""

    plugins: PluginManager
    values: Values


_lock = threading.Lock()
_services: Services | None = None


def services() -> Services:
    """Carrega os plugins (na primeira chamada) e devolve as peças. Chamar de novo devolve as mesmas."""
    global _services
    with _lock:
        if _services is None:
            MANAGER.load()
            _services = Services(plugins=MANAGER, values=MANAGER.values)  # as mesmas onde os plugins publicam
        return _services
