"""Onde ficam as coisas: os recursos que vêm com o app e os dados da pessoa.

Recursos (só leitura): o editor, as traduções, as fontes, o config de exemplo e os plugins embutidos. Ficam na
pasta do projeto, ou dentro do pacote quando o app roda como executável (PyInstaller: `sys.frozen`).

Dados da pessoa (gravação), em dois lugares:
- o config, o histórico de versões e o .bak (backup da última gravação, ao lado do config): no executável, em
  `%APPDATA%\\Deck` (Arquivos de Programas não aceita gravação); em desenvolvimento, o config.yaml continua na
  pasta do projeto e o histórico em `%LOCALAPPDATA%\\D6Deck\\history`, como sempre;
- logs, token do editor e plugins instalados: em `%LOCALAPPDATA%\\D6Deck`, nos dois casos.

As pastas da pessoa são lidas na hora de cada chamada (os testes trocam APPDATA e LOCALAPPDATA). As funções que
mudam no executável aceitam `frozen=` (padrão: FROZEN), para os testes conferirem os dois jeitos.
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
STATIC = APP / "editor" / "static"  # tokens, fontes, traduções e índice do Lucide (o editor e o desenho usam)
LOCALES = APP / "locales"  # traduções do Python
BUILTIN_PLUGINS = APP / "plugins" / "builtin"
EDITOR_DIST = ROOT / "editor" / "dist"  # o editor (React), servido na raiz depois do npm run build
MAIN_SCRIPT = APP / "__main__.py"  # o que o "iniciar com o Windows" roda (fora do executável)
EXAMPLE_CONFIG = ROOT / "config.example.yaml"
CONFIG_NAME = "config.yaml"

# O que o app lê do pacote enquanto roda. O `--check` do executável confere que cada um existe (a CI de versão
# roda ele), e o packaging/deck.spec leva cada um. Do app/editor/static, só a fonte e o índice do Lucide (o
# desenho das teclas): o resto entra no build do editor.
RESOURCES = {
    "editor": EDITOR_DIST / "index.html",
    "lucide index": STATIC / "lucide-index.json",
    "lucide font": STATIC / "fonts" / "lucide.ttf",
    "translations": LOCALES / "pt-BR.json",
    "example config": EXAMPLE_CONFIG,
    **{f"plugin {n}": BUILTIN_PLUGINS / n / "plugin.json" for n in ("obs", "discord", "weather")},
}


def missing_resources() -> list[str]:
    """Os recursos de RESOURCES que não estão no lugar (vazio = tudo certo)."""
    return [f"{name}: {p}" for name, p in RESOURCES.items() if not p.is_file()]


def _frozen(frozen: bool | None) -> bool:
    return FROZEN if frozen is None else frozen


def config_dir(*, frozen: bool | None = None) -> Path:
    """A pasta do config da pessoa. Executável: %APPDATA%\\Deck (criada se não existir). Desenvolvimento: a
    pasta do projeto."""
    if not _frozen(frozen):
        return ROOT
    d = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "Deck"
    d.mkdir(parents=True, exist_ok=True)
    return d


def default_config(*, frozen: bool | None = None) -> Path:
    """O config.yaml que o app usa quando não recebe --config."""
    return config_dir(frozen=frozen) / CONFIG_NAME


def history_dir(*, frozen: bool | None = None) -> Path:
    """Onde fica o histórico de versões (uma pasta por config, ver app/config/history.py)."""
    return (config_dir(frozen=True) if _frozen(frozen) else data_dir()) / "history"


def old_config(*, frozen: bool | None = None, executable: str | None = None) -> Path | None:
    """O config.yaml de antes da mudança para %APPDATA% (só no executável): o da pasta do Deck.exe, se existir.
    A primeira abertura copia esse arquivo (app/config/firstrun.py)."""
    if not _frozen(frozen):
        return None
    p = Path(sys.executable if executable is None else executable).parent / CONFIG_NAME
    return p if p.is_file() else None


def data_dir() -> Path:
    """A pasta de dados da pessoa (criada se não existir)."""
    d = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "D6Deck"
    d.mkdir(parents=True, exist_ok=True)
    return d
