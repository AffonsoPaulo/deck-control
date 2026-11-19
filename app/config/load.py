"""Leitura e validação do config.yaml.

load_config lê o arquivo; build_config valida um config já lido (dict) e monta o modelo tipado. A validação é
por seção, e cada seção devolve a lista dos seus problemas em vez de levantar no primeiro:

- app/config/model.py      o modelo (Config, KeySpec) e o que se pergunta a um config montado
- app/config/pages.py      pages: as teclas, os blocos e as páginas citadas pelas ações
- app/config/sections.py   as outras seções (widgets, automações, luz, log...)

O arquivo em disco (gravar, backups, histórico) é com o app/config/storage.py.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from app import i18n
from app.config.model import Config, KeySpec
from app.config.pages import DEFAULT_ACTIVE_OVERRIDE, build_pages, check_page_refs, cover_blocks
from app.config.sections import (
    LOGGING_FLAGS,
    build_automations,
    build_brightness,
    build_home,
    check_double_tap,
    check_lighting,
    check_logging,
    check_widgets,
    check_screen_color,
    temp_pages,
)
from app.errors import ConfigError  # mora em app/errors.py; continua importável daqui
from app.i18n import tr

__all__ = [
    "DEFAULT_ACTIVE_OVERRIDE",
    "LOGGING_FLAGS",
    "Config",
    "ConfigError",
    "KeySpec",
    "build_config",
    "load_config",
]


def load_config(path: Path) -> Config:
    path = Path(path)
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        raise ConfigError(tr("{file}: invalid YAML: {error}", file=path.name, error=e)) from None
    if isinstance(raw, dict):
        i18n.set_language(raw.get("language"))  # antes de validar: as mensagens já saem no idioma certo
    cfg = build_config(raw, path)
    cfg.mark_seen()
    return cfg


def build_config(raw: Any, path: Path) -> Config:
    """Valida um config já lido (dict) e monta o objeto. Levanta ConfigError com todos os problemas."""
    path = Path(path)
    if not isinstance(raw, dict):
        raise ConfigError(tr("{file}: the file must be an object (key: value)", file=path.name))
    raw_pages = raw.get("pages") or {}
    if not isinstance(raw_pages, dict) or not raw_pages:
        raise ConfigError(tr("define at least one page in 'pages:'"))

    # a ordem das seções é a ordem das mensagens
    problems: list[str] = []
    problems += check_widgets(raw.get("widgets"))
    pages = build_pages(raw_pages, raw.get("widgets"))
    problems += pages.problems
    cover = cover_blocks(pages.value)
    problems += cover.problems
    autos = build_automations(raw)
    problems += autos.problems
    temp = temp_pages(raw, pages.value)
    home = build_home(raw, pages.value)
    problems += home.problems
    problems += check_page_refs(pages.value)
    problems += check_lighting(raw)
    problems += check_double_tap(raw)
    problems += check_screen_color(raw)
    problems += check_logging(raw.get("logging"))
    brightness = build_brightness(raw)
    problems += brightness.problems
    # atalhos repetidos não impedem salvar: o editor avisa (binds.conflicts)
    if problems:
        raise ConfigError(tr("problems in the config:") + "\n  - " + "\n  - ".join(problems))

    return Config(
        path=path,
        raw=raw,
        pages=pages.value,
        home=home.value,
        brightness=brightness.value,
        lighting=raw.get("lighting") if isinstance(raw.get("lighting"), dict) else None,
        double_ms=int(raw.get("double_tap_ms", 250)),
        cover=cover.value,
        automations=autos.value,
        temp_pages=temp,
    )
