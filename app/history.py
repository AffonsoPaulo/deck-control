"""Histórico de versões do config.yaml.

Cada versão guarda o TEXTO exato do arquivo (com comentários), a hora e um
resumo do que mudou. Mudanças seguidas em pouco tempo (salvamento automático
enquanto a pessoa edita) entram na mesma versão, para o histórico não virar
uma versão por letra digitada.

Fica em %LOCALAPPDATA%\\D6Deck\\history\\<id do config>\\, separado por arquivo
de config, para configs de teste não se misturarem com o de verdade.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path

import yaml

from app import configio, winutil
from app.i18n import tr

MAX_ENTRIES = 300
MERGE_SECONDS = 90  # mudanças dentro desse intervalo viram uma versão só
MAX_SUMMARY = 8

_lock = threading.Lock()


def _dir(config_path: Path) -> Path:
    key = hashlib.sha1(str(Path(config_path).resolve()).lower().encode()).hexdigest()[:12]
    d = winutil.data_dir() / "history" / key
    d.mkdir(parents=True, exist_ok=True)
    return d


def _files(config_path: Path) -> list[Path]:
    return sorted(_dir(config_path).glob("*.json"))


def _load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def _safe_yaml(text: str) -> dict | None:
    try:
        v = yaml.safe_load(text)
        return v if isinstance(v, dict) else None
    except yaml.YAMLError:
        return None


# -- resumo das mudanças ------------------------------------------------------------


def _key_name(spec) -> str:
    if not isinstance(spec, dict):
        return ""
    icon = spec.get("icon")
    text = icon if isinstance(icon, str) else (icon or {}).get("text") if isinstance(icon, dict) else None
    return f' ("{str(text).replace(chr(10), " ")}")' if text else ""


def _sort_key(k):
    try:
        return (0, int(k))
    except (TypeError, ValueError):
        return (1, str(k))


def summarize(old: dict | None, new: dict | None) -> list[str]:
    if new is None:
        return [tr("File with a YAML error")]
    if old is None:
        return [tr("First saved version")]
    out: list[str] = []
    op, np = old.get("pages") or {}, new.get("pages") or {}
    created = [p for p in np if p not in op]
    deleted = [p for p in op if p not in np]
    for d in list(deleted):  # mesma página com outro nome = renomeada
        for c in list(created):
            if op[d] == np[c]:
                out.append(tr("Page {old} renamed to {new}", old=d, new=c))
                deleted.remove(d)
                created.remove(c)
                break
    out += [tr("Page {page} created", page=p) for p in created]
    out += [tr("Page {page} deleted", page=p) for p in deleted]
    for p in np:
        if p not in op:
            continue
        ok, nk = op[p] or {}, np[p] or {}
        for k in sorted(set(ok) | set(nk), key=_sort_key):
            if ok.get(k) == nk.get(k):
                continue
            if k not in ok:
                out.append(tr("Page {page}: key {key}{name} created", page=p, key=k, name=_key_name(nk[k])))
            elif k not in nk:
                out.append(tr("Page {page}: key {key}{name} removed", page=p, key=k, name=_key_name(ok[k])))
            else:
                out.append(tr("Page {page}: key {key}{name} changed", page=p, key=k, name=_key_name(nk[k])))
    labels = {
        "obs": "OBS connection changed",
        "discord": "Discord settings changed",
        "icons": "Key appearance changed",
        "device": "Image sending changed",
        "brightness": "Brightness changed",
        "lighting": "Deck light changed",
        "plugins": "Plugins changed",
        "language": "Language changed",
    }
    for sec, label in labels.items():
        if old.get(sec) != new.get(sec):
            out.append(tr(label))
    if old.get("home") != new.get("home") and new.get("home"):
        out.append(tr("Home page is now {page}", page=new["home"]))
    return out or [tr("Only formatting or comments")]


# os dois idiomas: versões antigas podem ter sido gravadas no outro
_STRUCTURAL = (
    " criada",
    " excluída",
    " renomeada",
    " apagada",
    "Primeira versão",
    "Página inicial agora",
    " created",
    " deleted",
    " renamed to ",
    " removed",
    "First saved version",
    "Home page is now",
)
_MORE = ("e mais ", "and ")


def _structural(items: list[str]) -> bool:
    return any(s in x for x in items for s in _STRUCTURAL)


def _identity(item: str) -> str:
    """'Página main: tecla 1 ("Mi") alterada' e '... ("Mic") alterada' são a mesma edição."""
    import re

    return re.sub(r' \("[^"]*"\)', "", item)


def _merge_summaries(a: list[str], b: list[str]) -> list[str]:
    out = [x for x in a if not x.startswith(_MORE)]
    for x in b:
        if x not in out:
            out.append(x)
    if len(out) > MAX_SUMMARY:
        out = out[: MAX_SUMMARY - 1] + [tr("and {n} more changes", n=len(out) - MAX_SUMMARY + 1)]
    return out


# -- API ------------------------------------------------------------------------------


def record(config_path: Path, reason: str | None = None) -> None:
    """Guarda o estado atual do arquivo, se for diferente da última versão."""
    path = Path(config_path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    with _lock:
        files = _files(path)
        last = _load(files[-1]) if files else None
        if last and last["text"] == text:
            return
        now = time.time()
        # Junta com a versão anterior só se for "a mesma edição continuando" (ex.: digitando
        # o nome da tecla 1): mesmos itens, sem nada estrutural. Criar/excluir/renomear página,
        # criar/apagar tecla, restaurar e importar sempre viram versões próprias.
        step = summarize(_safe_yaml(last["text"]), _safe_yaml(text)) if last else []
        mergeable = (
            last
            and not reason
            and not last.get("reason")
            and last.get("base_text") is not None
            and now - last["time"] < MERGE_SECONDS
            and not _structural(step)
            and not _structural(last["summary"])
            and {_identity(x) for x in step} <= {_identity(x) for x in last["summary"]}
        )
        if mergeable:
            # continua a mesma "sessão" de edição: atualiza a última versão
            base = _safe_yaml(last.get("base_text", "")) if last.get("base_text") is not None else None
            last.update(
                text=text,
                time=now,
                summary=summarize(base, _safe_yaml(text))
                if last.get("base_text") is not None
                else _merge_summaries(last["summary"], summarize(_safe_yaml(last["text"]), _safe_yaml(text))),
            )
            files[-1].write_text(json.dumps(last, ensure_ascii=False), encoding="utf-8")
            return
        entry = {
            "id": str(int(now * 1000)),
            "time": now,
            "reason": reason,
            "summary": summarize(_safe_yaml(last["text"]) if last else None, _safe_yaml(text)),
            "base_text": last["text"] if last else None,  # para refazer o resumo ao juntar mudanças
            "text": text,
        }
        (_dir(path) / f"{entry['id']}.json").write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
        for old in files[: max(0, len(files) + 1 - MAX_ENTRIES)]:
            old.unlink(missing_ok=True)


def entries(config_path: Path) -> list[dict]:
    """Versões, da mais nova para a mais antiga (sem o texto)."""
    with _lock:
        out = []
        for p in reversed(_files(config_path)):
            e = _load(p)
            out.append({"id": e["id"], "time": e["time"], "reason": e.get("reason"), "summary": e["summary"]})
        return out


def restore(config_path: Path, entry_id: str) -> str:
    """Volta o config.yaml para uma versão. Devolve a descrição da versão restaurada."""
    path = Path(config_path)
    p = _dir(path) / f"{int(entry_id)}.json"
    if not p.exists():
        raise ValueError(tr("version not found in the history"))
    e = _load(p)
    if _safe_yaml(e["text"]) is None:
        raise ValueError(tr("this version has a YAML error and can't be restored"))
    configio.replace_text(path, e["text"])
    when = time.strftime(tr("%m/%d at %H:%M"), time.localtime(e["time"]))
    record(path, reason=tr("Went back to the version from {when}", when=when))
    return when
