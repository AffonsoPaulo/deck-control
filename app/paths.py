"""Onde ficam as coisas: os recursos que vêm com o app e os dados da pessoa.

Recursos (só leitura): o editor, as traduções, as fontes e os plugins embutidos. Ficam na pasta do projeto, ou
dentro do pacote quando o app roda como executável (PyInstaller: `sys.frozen`).

Dados da pessoa (gravação): logs, histórico de versões, token do editor, plugins instalados. Ficam em
`%LOCALAPPDATA%\\D6Deck`, lido na hora de cada chamada (os testes trocam essa variável).

O config ainda fica na pasta do projeto. A mudança para `%APPDATA%\\Deck` é da Fase 7 do docs/plano-python.md,
e mexe só aqui.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))  # rodando como executável


def _root() -> Path:
    if FROZEN:  # PyInstaller: os arquivos do pacote ficam em sys._MEIPASS (a pasta _internal do modo pasta)
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


ROOT = _root()
APP = ROOT / "app"
STATIC = APP / "editor" / "static"  # o editor (HTML, CSS, JS, fontes, traduções do editor)
LOCALES = APP / "locales"  # traduções do Python
BUILTIN_PLUGINS = APP / "plugins" / "builtin"
MAIN_SCRIPT = APP / "__main__.py"  # o que o "iniciar com o Windows" roda (fora do executável)
EXAMPLE_CONFIG = ROOT / "config.example.yaml"


def default_config() -> Path:
    """O config.yaml que o app usa quando não recebe --config."""
    return ROOT / "config.yaml"


def data_dir() -> Path:
    """A pasta de dados da pessoa (criada se não existir)."""
    d = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "D6Deck"
    d.mkdir(parents=True, exist_ok=True)
    return d
