"""Primeira abertura do executável: trazer o config.yaml de antes da mudança para %APPDATA%\\Deck.

No executável, o config fica em %APPDATA%\\Deck (app/paths.py). Quem já usava o Deck com um config.yaml na pasta
do Deck.exe não pode abrir com o exemplo e perder as teclas: na primeira abertura (o config novo ainda não
existe), o app COPIA o arquivo antigo, nunca move. O antigo fica onde estava, sem mudança.

Vão junto as imagens das teclas (caminhos relativos ao config: as referenciadas e a pasta icons/, para onde vão
as enviadas pelo editor) e o histórico de versões do arquivo antigo, se houver. O config só passa a existir no
lugar novo depois de copiado e conferido (grava num .tmp, confere os bytes e troca): uma cópia pela metade nunca
vira o config. A validação do conteúdo é a de sempre, ao carregar.

Em desenvolvimento não faz nada: o config continua na pasta do projeto.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path

import yaml

from app import paths
from app.config import history

ICONS = "icons"  # a pasta das imagens enviadas pelo editor, ao lado do config


@dataclass(frozen=True, slots=True)
class Copied:
    """O que a primeira abertura copiou."""

    old: Path
    new: Path
    images: int
    history: bool


def copy_old_config(config: Path, *, frozen: bool | None = None, executable: str | None = None) -> Copied | None:
    """Copia o config antigo para `config`, se for a primeira abertura do executável com o config padrão.
    Devolve o que copiou, ou None quando não havia nada a fazer."""
    frozen = paths.FROZEN if frozen is None else frozen
    if not frozen or config.exists() or config.resolve() != paths.default_config(frozen=True).resolve():
        return None  # desenvolvimento, já aberto antes, ou um --config escolhido à mão
    old = paths.old_config(frozen=True, executable=executable)
    if old is None or old.resolve() == config.resolve():
        return None
    return copy_config(old, config)


def copy_config(old: Path, new: Path) -> Copied:
    """Copia o config `old` (com as imagens e o histórico) para `new`, que ainda não existe."""
    new.parent.mkdir(parents=True, exist_ok=True)
    data = old.read_bytes()
    tmp = new.with_name(new.name + ".tmp")
    tmp.write_bytes(data)
    if tmp.read_bytes() != data:  # a cópia não confere: o config novo não nasce
        tmp.unlink(missing_ok=True)
        raise OSError(f"the copy of {old} doesn't match the original")
    images = _copy_images(old.parent, new.parent, _raw(data))
    copied_history = _copy_history(old, new)
    os.replace(tmp, new)  # por último: até aqui, a próxima abertura tentaria de novo
    return Copied(old, new, images, copied_history)


def _raw(data: bytes) -> dict[str, object]:
    try:
        raw = yaml.safe_load(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, yaml.YAMLError):
        return {}  # o arquivo vai assim mesmo; o erro aparece ao carregar, como sempre
    return raw if isinstance(raw, dict) else {}


def _copy_images(old_dir: Path, new_dir: Path, raw: dict[str, object]) -> int:
    """As imagens com caminho relativo ao config: as referenciadas pelas teclas e a pasta icons/. Não troca uma
    que já existe no lugar novo."""
    from app.config.transfer import referenced_images

    rels = set(referenced_images(raw))
    icons = old_dir / ICONS
    if icons.is_dir():
        rels |= {p.relative_to(old_dir).as_posix() for p in icons.rglob("*") if p.is_file()}
    base = old_dir.resolve()
    n = 0
    for rel in sorted(rels):
        src = (old_dir / rel).resolve()
        dst = new_dir / rel
        if not src.is_file() or base not in src.parents or dst.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        n += 1
    return n


def _copy_history(old: Path, new: Path) -> bool:
    """As versões guardadas do config antigo passam a ser as do novo (no executável ou em desenvolvimento, o
    histórico do arquivo antigo pode estar em qualquer uma das duas pastas)."""
    target = paths.history_dir(frozen=True) / history.key(new)
    if target.exists():
        return False
    for base in (paths.history_dir(frozen=True), paths.history_dir(frozen=False)):
        src = base / history.key(old)
        if src.is_dir() and any(src.glob("*.json")):
            shutil.copytree(src, target)
            return True
    return False
