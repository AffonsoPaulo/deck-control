"""Exportar e importar a configuração do D6.

Exportar gera um .zip com o config.yaml (texto exato, com comentários) e as
imagens usadas nas teclas. A senha do OBS vai em branco, a não ser que a
pessoa peça para incluir.

Importar aceita esse .zip ou um .yaml solto, em dois modos:
    replace  substitui tudo (mantém a senha do OBS atual se o arquivo não tiver uma)
    merge    só acrescenta as páginas do arquivo (renomeia as que já existem)
"""

from __future__ import annotations

import copy
import io
import re
import time
import zipfile
from pathlib import Path, PurePosixPath

import yaml

from app import configio
from app.config import build_config
from app.i18n import tr

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp"}
MAX_IMAGE = 5 * 1024 * 1024
README = """Configuração do app do Fifine D6.

Para usar em outro PC: abra o editor do D6, vá em Configurações > Backup > Importar
e escolha este arquivo .zip.
"""


# -- imagens referenciadas -------------------------------------------------------------


def _icon_specs(plain: dict):
    for keys in (plain.get("pages") or {}).values():
        for spec in (keys or {}).values():
            if isinstance(spec, dict):
                for f in ("icon", "active_icon"):
                    if isinstance(spec.get(f), dict):
                        yield spec[f]


def referenced_images(plain: dict) -> set[str]:
    out = set()
    for icon in _icon_specs(plain):
        img = icon.get("image")
        if isinstance(img, str) and img and not Path(img).is_absolute() and ".." not in Path(img).parts:
            out.add(img.replace("\\", "/"))
    return out


# -- exportar ---------------------------------------------------------------------------


def export_zip(config_path: Path, include_secrets: bool = False) -> tuple[str, bytes]:
    config_path = Path(config_path)
    text = config_path.read_text(encoding="utf-8")
    if not include_secrets:
        from app.plugins import MANAGER

        text = configio.without_secrets(text, MANAGER.secret_paths())
    plain = yaml.safe_load(text) or {}
    base = config_path.parent.resolve()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("config.yaml", text)
        for rel in sorted(referenced_images(plain)):
            p = (base / rel).resolve()
            if p.is_file() and base in p.parents:
                z.write(p, rel)
        z.writestr("leia-me.txt", README)
    return f"d6-config-{time.strftime('%Y-%m-%d')}.zip", buf.getvalue()


# -- importar ---------------------------------------------------------------------------


def read_import(name: str, data: bytes) -> tuple[dict, dict[str, bytes]]:
    """Lê o arquivo enviado. Devolve (config, {caminho relativo da imagem: bytes})."""
    images: dict[str, bytes] = {}
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = z.namelist()
            cfg_name = (
                "config.yaml"
                if "config.yaml" in names
                else next((n for n in names if n.lower().endswith((".yaml", ".yml")) and "/" not in n.strip("/")), None)
            )
            if not cfg_name:
                raise ValueError(tr("the .zip has no config.yaml"))
            text = z.read(cfg_name).decode("utf-8-sig")
            for n in names:
                pp = PurePosixPath(n)
                if n.endswith("/") or pp.is_absolute() or ".." in pp.parts or pp.suffix.lower() not in IMAGE_EXT:
                    continue
                info = z.getinfo(n)
                if info.file_size <= MAX_IMAGE:
                    images[str(pp)] = z.read(n)
    else:
        text = data.decode("utf-8-sig")
    try:
        plain = yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise ValueError(tr("the file isn't valid YAML: {error}", error=e)) from None
    if not isinstance(plain, dict) or not isinstance(plain.get("pages"), dict) or not plain["pages"]:
        raise ValueError(tr("the file doesn't look like a Deck setup (the pages section is missing)"))
    return plain, images


def summarize_import(plain: dict, images: dict) -> dict:
    pages = plain.get("pages") or {}
    return {
        "pages": [str(p) for p in pages],
        "keys": sum(len(k or {}) for k in pages.values()),
        "images": len(images),
        "settings": [s for s in ("obs", "discord", "icons", "device", "brightness", "home") if s in plain],
    }


def _save_images(config_path: Path, plain: dict, images: dict[str, bytes]) -> None:
    """Grava as imagens ao lado do config e corrige os caminhos se precisar renomear."""
    base = Path(config_path).parent
    mapping: dict[str, str] = {}
    for rel, data in images.items():
        target = base / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        stem, suffix, n = target.stem, target.suffix, 1
        while target.exists() and target.read_bytes() != data:
            target = target.with_name(f"{stem}-{n}{suffix}")
            n += 1
        target.write_bytes(data)
        mapping[rel] = target.relative_to(base).as_posix()
    for icon in _icon_specs(plain):
        img = icon.get("image")
        if isinstance(img, str) and img.replace("\\", "/") in mapping:
            icon["image"] = mapping[img.replace("\\", "/")]


def _rename_page_refs(spec, old: str, new: str):
    if isinstance(spec, str):
        return f"page:{new}" if spec == f"page:{old}" else spec
    if isinstance(spec, list):
        return [_rename_page_refs(s, old, new) for s in spec]
    if isinstance(spec, dict):
        out = {}
        for k, v in spec.items():
            if k == "page" and v == old and spec.get("type") == "page":
                out[k] = new
            else:
                out[k] = _rename_page_refs(v, old, new)
        return out
    return spec


def _keep_secrets(current: dict, new: dict) -> None:
    """Backup exportado vem com as senhas em branco: mantém as que já estão no config atual."""
    from app.plugins import MANAGER

    for path in MANAGER.secret_paths():
        cur, dst = current, new
        for k in path[:-1]:
            cur = cur.get(k) if isinstance(cur, dict) else None
            dst = dst.get(k) if isinstance(dst, dict) else None
        if isinstance(cur, dict) and isinstance(dst, dict) and cur.get(path[-1]) and not dst.get(path[-1]):
            dst[path[-1]] = cur[path[-1]]


def build_import(config_path: Path, plain: dict, images: dict[str, bytes], mode: str) -> dict:
    """Monta o config resultante (sem gravar). Levanta ConfigError se ficar inválido."""
    config_path = Path(config_path)
    current = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    plain = copy.deepcopy(plain)
    _save_images(config_path, plain, images)
    if mode == "replace":
        new = plain
        _keep_secrets(current, new)
    elif mode == "merge":
        new = copy.deepcopy(current)
        new.setdefault("pages", {})
        renames = {}
        for page in plain["pages"]:
            target, n = str(page), 2
            while target in new["pages"] or target in renames.values():
                target = f"{page} ({n})"
                n += 1
            renames[str(page)] = target
        for page, keys in plain["pages"].items():
            keys = copy.deepcopy(keys or {})
            for old, newname in renames.items():
                if old != newname:
                    keys = {k: _rename_page_refs(v, old, newname) for k, v in keys.items()}
            new["pages"][renames[str(page)]] = keys
    else:
        raise ValueError(tr("unknown import mode"))
    build_config(new, config_path)  # valida antes de gravar
    return new


def safe_filename(name: str) -> str:
    return re.sub(r"[^\w.\- ]+", "_", Path(str(name)).name)[:80] or "arquivo"
