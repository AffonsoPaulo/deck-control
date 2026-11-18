"""As seções do config fora de pages: widgets, automações, páginas temporárias, página inicial, luz, toque duplo,
log, brilho e envio de imagens.

Cada validador devolve a lista dos problemas da sua seção (vazia = tudo certo), sem levantar no primeiro; os que
também montam um valor devolvem Checked(valor, problemas). A ordem em que o build_config os chama é a ordem das
mensagens para a pessoa.
"""

from __future__ import annotations

from typing import Any

from app import automations, lighting, logs, widgets
from app.configmodel import Checked, Pages
from app.i18n import tr

LOGGING_FLAGS = ("detail", "show_tab", "key_error", "notify")
DRAW_OPTIONS = ("session", "per_key_session", "key_delay", "pace")  # device: o que vai para o envio das imagens


def check_widgets(raw_widgets: object) -> list[str]:
    """widgets: {id do widget: descrição} (os da pessoa)."""
    if raw_widgets is None:
        return []
    if not isinstance(raw_widgets, dict):
        return [tr("widgets: expected an object (widget id: description)")]
    problems = []
    for name, wd in raw_widgets.items():
        problem = widgets.check(str(name), wd)
        if problem:
            problems.append(problem)
    return problems


def build_automations(raw: dict[str, Any]) -> Checked[list[dict[str, Any]]]:
    """automations: lista de {when, do}. As que não são objeto ficam de fora."""
    autos = raw.get("automations") or []
    if not isinstance(autos, list):
        return Checked([], [tr("automations: expected a list")])
    problems = []
    for ai, a in enumerate(autos):
        problems += automations.validate(a, f"automations.{ai + 1}")
    return Checked([a for a in autos if isinstance(a, dict)], problems)


def temp_pages(raw: dict[str, Any], pages: Pages) -> list[str]:
    """temp_pages: as páginas que abrem como temporárias (as que não existem são ignoradas)."""
    return [str(p) for p in (raw.get("temp_pages") or []) if str(p) in pages]


def build_home(raw: dict[str, Any], pages: Pages) -> Checked[str]:
    """home: a página inicial (padrão: a primeira)."""
    home = str(raw.get("home") or next(iter(pages)))
    if home not in pages:
        return Checked(home, [tr("home: page '{page}' doesn't exist", page=home)])
    return Checked(home, [])


def check_lighting(raw: dict[str, Any]) -> list[str]:
    """lighting: o anel de luz do Deck (validado pelo app/lighting.py)."""
    problems: list[str] = lighting.validate(raw.get("lighting"))
    return problems


# Cor das telas: a tela do D6 exagera o azul nos tons escuros e lava as cores fortes (o roxo sai azul). Calibrado
# no D6 de verdade em 2026-11-18 com tools/screen_color.py: (vermelho, azul, saturação) de d6.render.screen_correct.
SCREEN_COLOR = (0.82, 1.45, 1.3)
SCREEN_COLOR_RANGES = {"red": (0.3, 1.5), "blue": (0.5, 3.0), "saturation": (0.5, 2.5)}


def screen_color(raw: dict[str, Any]) -> tuple[float, float, float] | None:
    """device.screen_color: a correção das telas (ligada por padrão), false desliga, ou {red, blue, saturation}."""
    dev = raw.get("device")
    v = dev.get("screen_color", True) if isinstance(dev, dict) else True
    if v is False:
        return None
    if isinstance(v, dict):
        try:
            return tuple(float(v.get(k, d)) for k, d in zip(SCREEN_COLOR_RANGES, SCREEN_COLOR, strict=True))  # type: ignore[return-value]
        except (TypeError, ValueError):
            return SCREEN_COLOR  # o problema já vai para a lista (check_screen_color)
    return SCREEN_COLOR


def check_screen_color(raw: dict[str, Any]) -> list[str]:
    dev = raw.get("device")
    v = dev.get("screen_color") if isinstance(dev, dict) else None
    if v is None or isinstance(v, bool):
        return []
    if not isinstance(v, dict):
        return [tr("device.screen_color: use true, false or {red, blue, saturation}")]
    out = []
    for k, (lo, hi) in SCREEN_COLOR_RANGES.items():
        x = v.get(k)
        if x is not None and not (isinstance(x, (int, float)) and not isinstance(x, bool) and lo <= x <= hi):
            out.append(tr("device.screen_color.{field}: a number from {lo} to {hi}", field=k, lo=lo, hi=hi))
    return out


def check_double_tap(raw: dict[str, Any]) -> list[str]:
    """double_tap_ms: a janela do toque duplo."""
    dt = raw.get("double_tap_ms")
    if dt is not None and not (isinstance(dt, (int, float)) and 120 <= dt <= 800):
        return [tr("double_tap_ms: a number from {lo} to {hi}", lo=120, hi=800)]
    return []


def check_logging(lg: object) -> list[str]:
    """logging: {detail, areas, show_tab, key_error, notify} (ver config.example.yaml)."""
    if lg is None:
        return []
    if not isinstance(lg, dict):
        return [tr("logging: expected an object with detail/areas/show_tab/key_error/notify")]
    problems = []
    unknown = set(lg) - {*LOGGING_FLAGS, "areas"}
    if unknown:
        problems.append(tr("logging: unknown fields {fields}", fields=sorted(unknown)))
    for f in LOGGING_FLAGS:
        if f in lg and not isinstance(lg[f], bool):
            problems.append(tr("logging.{field}: use true or false", field=f))
    areas = lg.get("areas")
    if areas is not None:
        if not isinstance(areas, list):
            problems.append(tr("logging.areas: expected a list (use {areas})", areas=", ".join(logs.AREAS)))
        else:
            for a in areas:
                if a not in logs.AREAS:
                    problems.append(
                        tr("logging.areas: unknown area '{area}' (use {areas})", area=a, areas=", ".join(logs.AREAS))
                    )
    return problems


def build_brightness(raw: dict[str, Any]) -> Checked[int]:
    """brightness: o brilho das telas, de 0 a 100 (padrão 100).

    Fora da faixa não é erro: fica no limite mais perto, como já faziam o Deck e a ação 'brightness' (um config
    com brightness: 150 sempre abriu, e continua abrindo). Só o que não é número vira problema.
    """
    value = raw.get("brightness", 100)
    try:
        n = int(value)
    except (TypeError, ValueError, OverflowError):
        return Checked(100, [tr("brightness: a number from {lo} to {hi}", lo=0, hi=100)])
    return Checked(max(0, min(100, n)), [])


def draw_options(raw: dict[str, Any]) -> dict[str, Any]:
    """device: as opções do envio das imagens que o engine usa."""
    dev = raw.get("device") or {}
    return {k: dev[k] for k in DRAW_OPTIONS if k in dev}
