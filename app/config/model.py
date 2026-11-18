"""O modelo tipado do config: o que o app usa depois de validar (Config e uma KeySpec por tecla).

Quem monta é o app/config/load.py (build_config), com os validadores de cada seção (app/config/pages.py e
app/config/sections.py). Aqui ficam só os tipos e o que se pergunta a um config já montado.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app import actions

Action = dict[str, Any] | None  # ação já normalizada (actions.normalize); None = a tecla não faz nada nesse momento
Icon = dict[str, Any]
Cover = dict[str, dict[int, tuple[int, int]]]  # página -> tecla coberta -> (tecla do bloco, índice da célula)

MOMENTS = ("action", "double", "hold", "release")  # os campos de ação de uma tecla


@dataclass(frozen=True, slots=True)
class Checked[T]:
    """O que um validador de seção devolve: o valor montado e a lista dos problemas (vazia = tudo certo).

    Os validadores não levantam no primeiro problema: juntam todos, e o build_config mostra a lista inteira.
    """

    value: T
    problems: list[str]


@dataclass
class KeySpec:
    icon: Icon
    active_icon: Icon
    state: str | None
    action: Action
    hold: Action
    hold_ms: int
    release: Action
    light: dict[str, Any] | None = None
    double: Action = None  # toque duplo
    repeat: str | None = None  # "press" | "hold": repete enquanto a tecla estiver apertada
    repeat_ms: int = 80  # intervalo da repetição
    repeat_delay: int = 400  # repeat: press — espera antes de começar a repetir
    # [{if: condição, icon: {...}}]: a primeira que valer muda a aparência
    rules: list[dict[str, Any]] = field(default_factory=list)
    span: tuple[int, int] = (1, 1)  # bloco: (colunas, linhas) a partir desta tecla (canto de cima à esquerda)
    cells: list[Icon] = field(default_factory=list)  # bloco "distribuir": um ícone por tecla, em ordem de leitura
    mode: str = "split"  # bloco: "split" (cada tecla uma parte) | "image" (uma imagem atravessando as telas)
    dynamic: bool = False  # mostra valores ou tem regras: o engine redesenha sozinho

    def moments(self) -> tuple[Action, ...]:
        """As ações da tecla, na ordem de MOMENTS."""
        return (self.action, self.double, self.hold, self.release)


Pages = dict[str, dict[int, KeySpec]]  # página -> tecla (1 a 15) -> KeySpec


@dataclass
class Config:
    path: Path
    raw: dict[str, Any]
    pages: Pages
    home: str
    brightness: int
    draw_options: dict[str, Any] = field(default_factory=dict)
    lighting: dict[str, Any] | None = None
    double_ms: int = 250  # janela do toque duplo
    cover: Cover = field(default_factory=dict)  # {página: {tecla coberta: (tecla do bloco, índice da célula)}}
    automations: list[dict[str, Any]] = field(default_factory=list)
    temp_pages: list[str] = field(default_factory=list)
    _mtime: float = 0.0

    @property
    def base_dir(self) -> Path:
        return self.path.parent

    def page_keys(self, page: str) -> dict[int, KeySpec]:
        return self.pages.get(page, {})

    def spec_at(self, page: str, key: int) -> tuple[KeySpec | None, int]:
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
                for a in k.moments():
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


def child_actions(spec: dict[str, Any]) -> list[Any]:
    """As ações de dentro de uma ação (multi, toggle, if...), para percorrer a árvore.

    Uma ação pela metade (o toggle sem 'on', o multi sem 'actions') não tem filhas: quem conta o problema é o
    actions.validate; percorrer não pode quebrar.
    """
    try:
        d = actions.REGISTRY.get(spec.get("type"))  # type: ignore[arg-type]  # o 'type' do config, seja o que for
        return list(d.children(spec)) if d is not None and d.children else []
    except (KeyError, TypeError):
        return []


def _collect_if_states(spec: object, out: set[str]) -> None:
    spec = actions.normalize(spec)
    if not isinstance(spec, dict):
        return
    if spec.get("type") == "if" and spec.get("state"):
        out.add(str(spec["state"]))
    for child in child_actions(spec):
        _collect_if_states(child, out)
