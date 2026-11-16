"""Leitura e validação do config.yaml."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from app import actions, icons, lighting
from d6.device import COLS, KEY_COUNT
from app.i18n import tr
from app import automations, values
from app import i18n

DEFAULT_ACTIVE_OVERRIDE = {"bg": "#C62828"}


class ConfigError(ValueError):
    pass


@dataclass
class KeySpec:
    icon: dict
    active_icon: dict
    state: str | None
    action: object
    hold: object
    hold_ms: int
    release: object
    light: dict | None = None
    double: object = None          # toque duplo
    repeat: str | None = None      # "press" | "hold": repete enquanto a tecla estiver apertada
    repeat_ms: int = 80            # intervalo da repetição
    repeat_delay: int = 400        # repeat: press — espera antes de começar a repetir
    rules: list = field(default_factory=list)   # [{if: condição, icon: {...}}]: a primeira que valer muda a aparência
    span: tuple = (1, 1)           # bloco: (colunas, linhas) a partir desta tecla (canto de cima à esquerda)
    cells: list = field(default_factory=list)   # bloco "distribuir": um ícone por tecla, em ordem de leitura
    mode: str = "split"            # bloco: "split" (cada tecla uma parte) | "image" (uma imagem atravessando as telas)
    dynamic: bool = False          # mostra valores ou tem regras: o engine redesenha sozinho


@dataclass
class Config:
    path: Path
    raw: dict
    pages: dict[str, dict[int, KeySpec]]
    home: str
    brightness: int
    draw_options: dict = field(default_factory=dict)
    lighting: dict | None = None
    double_ms: int = 250           # janela do toque duplo
    cover: dict = field(default_factory=dict)   # {página: {tecla coberta: (tecla do bloco, índice da célula)}}
    automations: list = field(default_factory=list)
    temp_pages: list = field(default_factory=list)
    _mtime: float = 0.0

    @property
    def base_dir(self) -> Path:
        return self.path.parent

    def page_keys(self, page: str) -> dict[int, KeySpec]:
        return self.pages.get(page, {})

    def spec_at(self, page: str, key: int):
        """(KeySpec, índice da célula) da tecla, inclusive das cobertas por um bloco; (None, 0) se vazia."""
        keys = self.pages.get(page, {})
        if key in keys:
            return keys[key], 0
        anchor = self.cover.get(page, {}).get(key)
        if anchor:
            return keys.get(anchor[0]), anchor[1]
        return None, 0

    def all_states(self) -> set[str]:
        """Estados que o app precisa acompanhar: os dos ícones e os usados em condições ('if')."""
        states = {k.state for keys in self.pages.values() for k in keys.values() if k.state}
        for keys in self.pages.values():
            for k in keys.values():
                for a in (k.action, k.double, k.hold, k.release):
                    _collect_if_states(a, states)
        return states

    def changed_on_disk(self) -> bool:
        try:
            return self.path.stat().st_mtime != self._mtime
        except OSError:
            return False

    def mark_seen(self) -> None:
        try:
            self._mtime = self.path.stat().st_mtime
        except OSError:
            pass


def _collect_if_states(spec, out: set) -> None:
    spec = actions.normalize(spec)
    if not isinstance(spec, dict):
        return
    if spec.get("type") == "if" and spec.get("state"):
        out.add(str(spec["state"]))
    d = actions.REGISTRY.get(spec.get("type"))
    if d and d.children:
        try:
            for child in d.children(spec):
                _collect_if_states(child, out)
        except (KeyError, TypeError):
            pass


def _span(value, n: int, where: str, errors: list) -> tuple:
    """span: [colunas, linhas]; o bloco tem que caber na grade a partir da tecla n."""
    if value is None:
        return (1, 1)
    try:
        cols, rows = int(value[0]), int(value[1])
    except (TypeError, ValueError, IndexError):
        errors.append(tr("{where}.span: use [columns, rows], e.g. [2, 1]", where=where))
        return (1, 1)
    col, row = (n - 1) % COLS, (n - 1) // COLS
    if cols < 1 or rows < 1 or col + cols > COLS or row + rows > KEY_COUNT // COLS:
        errors.append(tr("{where}.span: a {w}x{h} block doesn't fit starting at this key", where=where, w=rows, h=cols))
        return (1, 1)
    return (cols, rows)


def _is_dynamic(k: dict) -> bool:
    """Mostra valores ({id}), tem regras, barra ou cor por faixa: precisa ser redesenhada sozinha."""
    if k.get("rules"):
        return True
    for icon in [k.get("icon"), k.get("active_icon"), *(k.get("cells") or [])]:
        if isinstance(icon, dict):
            if isinstance(icon.get("bar"), dict) or isinstance(icon.get("bg"), dict):
                return True
            if any(values.has_tokens(v) for v in icon.values()):
                return True
        elif values.has_tokens(icon):
            return True
    return False


def _icon(value, where: str) -> dict:
    if value is None:
        return {}
    if isinstance(value, str):
        return {"text": value}
    if not isinstance(value, dict):
        raise ConfigError(tr("{where}: the icon must be text or an object with bg/text/lucide/image", where=where))
    return dict(value)


def _page_refs(spec) -> list[str]:
    """Todas as páginas citadas por ações 'page' (inclusive dentro de multi/toggle)."""
    spec = actions.normalize(spec)
    if not isinstance(spec, dict):
        return []
    out = []
    if spec.get("type") == "page":
        out.append(str(spec.get("page")))
    d = actions.REGISTRY.get(spec.get("type"))
    if d and d.children:
        for child in d.children(spec):
            out += _page_refs(child)
    return out


def load_config(path: Path) -> Config:
    path = Path(path)
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        raise ConfigError(tr("{file}: invalid YAML: {error}", file=path.name, error=e)) from None
    if isinstance(raw, dict):
        i18n.set_language(raw.get("language"))     # antes de validar: as mensagens já saem no idioma certo
    cfg = build_config(raw, path)
    cfg.mark_seen()
    return cfg


def build_config(raw: dict, path: Path) -> Config:
    """Valida um config já lido (dict) e monta o objeto. Levanta ConfigError com todos os problemas."""
    path = Path(path)
    if not isinstance(raw, dict):
        raise ConfigError(tr("{file}: the file must be an object (key: value)", file=path.name))

    raw_pages = raw.get("pages") or {}
    if not isinstance(raw_pages, dict) or not raw_pages:
        raise ConfigError(tr("define at least one page in 'pages:'"))

    errors: list[str] = []
    pages: dict[str, dict[int, KeySpec]] = {}
    for page_name, keys in raw_pages.items():
        page_name = str(page_name)
        pages[page_name] = {}
        for key_id, k in (keys or {}).items():
            where = f"pages.{page_name}.{key_id}"
            try:
                n = int(key_id)
            except (TypeError, ValueError):
                errors.append(tr("{where}: the key must be a number from 1 to {n}", where=where, n=KEY_COUNT))
                continue
            if not 1 <= n <= KEY_COUNT:
                errors.append(tr("{where}: the key must be from 1 to {n}", where=where, n=KEY_COUNT))
                continue
            if k is None:
                continue
            if not isinstance(k, dict):
                errors.append(tr("{where}: expected an object with icon/action", where=where))
                continue
            unknown = set(k) - {"icon", "active_icon", "state", "action", "double", "hold", "hold_ms", "release", "light",
                                "repeat", "repeat_ms", "repeat_delay", "rules", "span", "cells", "mode", "format", "panel"}
            if unknown:
                errors.append(tr("{where}: unknown fields {fields}", where=where, fields=sorted(unknown)))
            for field_name in ("action", "double", "hold", "release"):
                errors += actions.validate(k.get(field_name), f"{where}.{field_name}")
            rules = k.get("rules") or []
            if not isinstance(rules, list):
                errors.append(tr("{where}.rules: expected a list", where=where))
                rules = []
            for ri, rule in enumerate(rules):
                errors += values.check_cond((rule or {}).get("if") if isinstance(rule, dict) else None, f"{where}.rules.{ri + 1}")
            span = _span(k.get("span"), n, where, errors)
            if k.get("mode") not in (None, "split", "image"):
                errors.append(tr("{where}.mode: use split or image", where=where))
            if k.get("repeat") not in (None, "press", "hold"):
                errors.append(tr("{where}.repeat: use press or hold", where=where))
            for f, lo, hi in (("repeat_ms", 20, 2000), ("repeat_delay", 0, 3000), ("hold_ms", 50, 10000)):
                v = k.get(f)
                if v is not None and not (isinstance(v, (int, float)) and lo <= v <= hi):
                    errors.append(tr("{where}.{field}: a number from {lo} to {hi}", where=where, field=f, lo=lo, hi=hi))
            errors += lighting.validate_key(k.get("light"), f"{where}.light")
            try:
                icon = _icon(k.get("icon"), f"{where}.icon")
                active_override = _icon(k.get("active_icon"), f"{where}.active_icon") or DEFAULT_ACTIVE_OVERRIDE
            except ConfigError as e:
                errors.append(str(e))
                continue
            key_id_str = f"{page_name}:{n}"
            state = k.get("state") or actions.state_of(k.get("action"), key_id_str)
            pages[page_name][n] = KeySpec(
                icon=icon,
                active_icon=icons.merge_icon(icon, active_override),
                state=state,
                action=actions.normalize(k.get("action")),
                hold=actions.normalize(k.get("hold")),
                hold_ms=int(k.get("hold_ms", 500)),
                release=actions.normalize(k.get("release")),
                light=k.get("light") if isinstance(k.get("light"), dict) else None,
                double=actions.normalize(k.get("double")),
                repeat=k.get("repeat") if k.get("repeat") in ("press", "hold") else None,
                repeat_ms=int(k.get("repeat_ms", 80)),
                repeat_delay=int(k.get("repeat_delay", 400)),
                rules=[r for r in rules if isinstance(r, dict)],
                span=span,
                cells=[c if isinstance(c, dict) else {"text": str(c)} for c in (k.get("cells") or [])],
                mode=k.get("mode") or "split",
                dynamic=_is_dynamic(k),
            )

    # blocos: as teclas cobertas apontam para a do canto; não podem ter nada próprio nem cruzar outro bloco
    cover: dict = {}
    for page_name, keys in pages.items():
        cov = cover.setdefault(page_name, {})
        for n, k in sorted(keys.items()):
            cols, rows = k.span
            if (cols, rows) == (1, 1):
                continue
            idx = 0
            for r in range(rows):
                for c in range(cols):
                    other = n + r * COLS + c
                    if other != n:
                        if other in keys:
                            errors.append(tr("pages.{page}.{key}: the key is inside the {w}x{h} block of key {anchor}", page=page_name, key=other, w=rows, h=cols, anchor=n))
                        elif other in cov:
                            errors.append(tr("pages.{page}: blocks of keys {a} and {b} overlap", page=page_name, a=cov[other][0], b=n))
                        cov[other] = (n, idx)
                    idx += 1

    autos = raw.get("automations") or []
    if not isinstance(autos, list):
        errors.append(tr("automations: expected a list"))
        autos = []
    for ai, a in enumerate(autos):
        errors += automations.validate(a, f"automations.{ai + 1}")
    temp_pages = [str(p) for p in (raw.get("temp_pages") or []) if str(p) in pages]

    home = str(raw.get("home") or next(iter(pages)))
    if home not in pages:
        errors.append(tr("home: page '{page}' doesn't exist", page=home))
    for page_name, keys in pages.items():
        for n, k in keys.items():
            for ref in sum((_page_refs(a) for a in (k.action, k.double, k.hold, k.release)), []):
                if ref not in pages and ref not in ("back", "home"):
                    errors.append(tr("pages.{page}.{key}: 'page' action points to '{ref}', which doesn't exist", page=page_name, key=n, ref=ref))

    errors += lighting.validate(raw.get("lighting"))
    dt = raw.get("double_tap_ms")
    if dt is not None and not (isinstance(dt, (int, float)) and 120 <= dt <= 800):
        errors.append(tr("double_tap_ms: a number from {lo} to {hi}", lo=120, hi=800))

    # atalhos repetidos não impedem salvar: o editor avisa (binds.conflicts)

    if errors:
        raise ConfigError(tr("problems in the config:") + "\n  - " + "\n  - ".join(errors))

    dev = raw.get("device") or {}
    draw_options = {k: dev[k] for k in ("session", "per_key_session", "key_delay", "pace") if k in dev}
    return Config(path=path, raw=raw, pages=pages, home=home,
                  brightness=int(raw.get("brightness", 100)), draw_options=draw_options,
                  lighting=raw.get("lighting") if isinstance(raw.get("lighting"), dict) else None,
                  double_ms=int(raw.get("double_tap_ms", 250)),
                  cover=cover, automations=[a for a in autos if isinstance(a, dict)], temp_pages=temp_pages)
