"""Plugins: integrações que acrescentam ações, configurações e estados ao app.

Cada plugin é uma pasta com um plugin.json (ver docs/plugins.md). Dois tipos:
  * embutidos (app/plugins/builtin/<id>): Python, rodam dentro do app (OBS, Discord);
  * de terceiros (pasta 'plugins' nos dados do app): um programa separado, em qualquer linguagem,
    que conversa com o app por linhas de JSON no stdin/stdout (app/plugins/external.py).
    Se o programa travar ou cair, o app continua.

As partes:
  manifest.py   ler, validar e traduzir o plugin.json
  api.py        o objeto que o plugin embutido recebe em setup(api)
  manager.py    descobre os plugins, registra as ações deles no registro de ações (app.actions.REGISTRY),
                liga/desliga cada um conforme o config e informa o estado (conectado, esperando...) ao editor
  external.py   o processo de um plugin de terceiros e o protocolo

Os nomes de sempre continuam importáveis daqui (`from app.plugins import MANAGER, read_manifest`).
"""

from __future__ import annotations

from app.errors import PluginError  # mora em app/errors.py; continua importável daqui
from app.plugins.api import PluginAPI
from app.plugins.manager import BUILTIN_DIR, MANAGER, Plugin, PluginManager, run_guard, user_dir
from app.plugins.manifest import (
    ID_RE,
    SETTING_KINDS,
    check_manifest,
    localize,
    missing_keys,
    read_locales,
    read_manifest,
)

__all__ = [
    "BUILTIN_DIR",
    "ID_RE",
    "MANAGER",
    "SETTING_KINDS",
    "Plugin",
    "PluginAPI",
    "PluginError",
    "PluginManager",
    "check_manifest",
    "localize",
    "missing_keys",
    "read_locales",
    "read_manifest",
    "run_guard",
    "user_dir",
]
