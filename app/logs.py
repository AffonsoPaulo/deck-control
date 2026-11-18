"""Logs do app: arquivo com rotação, visualizador do editor, problemas em aberto e senhas mascaradas.

Uso nos módulos:
    from app import logs
    log = logs.get("engine")                     # aparece como "engine" no log
    log.info("Page changed: %s -> %s", a, b)     # mensagens de log sempre em inglês
    log.debug("Key %s pressed", k)               # só grava com o Detalhado ligado para a área
    log.error("Action failed", exc_info=True, extra={"ctx": {"key": 3}})   # ctx vira os detalhes no editor

Níveis: erros, avisos e informações são sempre gravados; DEBUG depende de config.logging
(detail: true + areas: [keys, values, automations, plugins, editor, device]) ou do --debug.

Problemas em aberto (OBS que não conecta, plugin que parou, Deck desconectado) ficam num registro
à parte: o editor mostra uma faixa, a bandeja um alerta, e opcionalmente o Windows notifica.
"""

from __future__ import annotations

import collections
import io
import logging
import logging.handlers
import platform
import re
import sys
import threading
import time
import traceback
from pathlib import Path

ROOT = "deck"
AREAS = ("keys", "values", "automations", "plugins", "editor", "device")
# de qual área do "Detalhado" é o debug de cada origem (as que não estão aqui valem com qualquer área ligada)
AREA_OF = {
    "keys": "keys",
    "actions": "keys",
    "values": "values",
    "automations": "automations",
    "plugins": "plugins",
    "editor": "editor",
    "device": "device",
    "deck": "device",
}
LEVEL_NAME = {"DEBUG": "DEBUG", "INFO": "INFO", "WARNING": "WARN", "ERROR": "ERROR", "CRITICAL": "ERROR"}
MAX_BYTES = 2_000_000
BACKUPS = 4  # app.log + 4 antigos = 5 arquivos
BUFFER = 3000  # linhas guardadas na memória para a aba Logs

_lock = threading.RLock()
_secrets: set[str] = set()
_detail = False
_areas: set[str] = set()
_force_debug = False  # --debug: tudo detalhado, sem olhar o config
_records: collections.deque = collections.deque(maxlen=BUFFER)
_seq = 0
_counts = {"ERROR": 0, "WARN": 0}
_seen = 0  # último id visto na aba Logs (para o número de erros novos)
_problems: dict[str, dict] = {}
_listeners: list = []
_started = time.time()
_file: Path | None = None


def get(name: str) -> logging.Logger:
    return logging.getLogger(f"{ROOT}.{name}")


def short(name: str) -> str:
    """'deck.plugins.obs' -> 'obs'; 'deck.engine' -> 'engine'."""
    n = name[len(ROOT) + 1 :] if name.startswith(ROOT + ".") else name
    return n[len("plugins.") :] if n.startswith("plugins.") else n


# nomes de campo que sempre escondem o valor (em qualquer nível, ex.: headers de uma ação http)
SENSITIVE = (
    "password",
    "passwd",
    "secret",
    "token",
    "authorization",
    "auth",
    "api_key",
    "apikey",
    "cookie",
    "bearer",
    "credential",
    "session",
)
_URL_QUERY = re.compile(r"(https?://[^\s?#]+)\?[^\s#]*")


def mask(text: str) -> str:
    """Esconde as senhas conhecidas e a query das URLs (onde costumam ir tokens)."""
    if not text:
        return text
    for s in sorted(_secrets, key=len, reverse=True):
        text = text.replace(s, "****")
    return _URL_QUERY.sub(r"\1?****", text)


def _sensitive(k) -> bool:
    k = str(k).lower().replace("-", "_")
    return any(w in k for w in SENSITIVE)


def _mask_obj(v):
    if isinstance(v, str):
        return mask(v)
    if isinstance(v, dict):
        return {k: ("****" if _sensitive(k) and v[k] else _mask_obj(v[k])) for k in v}
    if isinstance(v, (list, tuple)):
        return [_mask_obj(x) for x in v]
    return v


# ---------------------------------------------------------------------------- filtros e formatos


class _AreaFilter(logging.Filter):
    """DEBUG só passa com o Detalhado ligado para a área de onde veio."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.levelno >= logging.INFO:
            return True
        if _force_debug:
            return True
        if not _detail:
            return False
        n = record.name[len(ROOT) + 1 :] if record.name.startswith(ROOT + ".") else record.name
        area = AREA_OF.get(n.split(".", 1)[0])
        return bool(_areas) if area is None else area in _areas


class _Formatter(logging.Formatter):
    def __init__(self, with_date: bool = True):
        super().__init__()
        self.with_date = with_date

    def format(self, record: logging.LogRecord) -> str:
        t = time.localtime(record.created)
        stamp = time.strftime("%Y-%m-%d %H:%M:%S" if self.with_date else "%H:%M:%S", t) + f".{int(record.msecs):03d}"
        line = f"{stamp} {LEVEL_NAME.get(record.levelname, record.levelname):<5} {short(record.name):<12} {mask(record.getMessage())}"
        ctx = getattr(record, "ctx", None)
        if ctx:
            line += "  " + " ".join(
                f"{k}={_mask_obj(v)!r}" if isinstance(v, str) else f"{k}={_mask_obj(v)}" for k, v in ctx.items()
            )
        if record.exc_info:
            line += "\n" + mask("".join(traceback.format_exception(*record.exc_info)).rstrip())
        elif record.stack_info:
            line += "\n" + mask(record.stack_info)
        elif getattr(record, "block", None):
            line += "\n" + "\n".join("    " + ln for ln in mask(record.block).split("\n"))
        return line


class _Buffer(logging.Handler):
    """Guarda as últimas linhas, já estruturadas, para a aba Logs do editor."""

    def emit(self, record: logging.LogRecord) -> None:
        global _seq
        try:
            level = LEVEL_NAME.get(record.levelname, record.levelname)
            tb = mask("".join(traceback.format_exception(*record.exc_info)).rstrip()) if record.exc_info else None
            if tb is None and getattr(record, "block", None):
                tb = mask(record.block)
            ctx = getattr(record, "ctx", None)
            with _lock:
                _seq += 1
                _records.append(
                    {
                        "id": _seq,
                        "t": record.created,
                        "level": level,
                        "area": short(record.name),
                        "msg": mask(record.getMessage()),
                        "ctx": _mask_obj(ctx) if ctx else None,
                        "tb": tb,
                    }
                )
                if level in _counts:
                    _counts[level] += 1
        except Exception:
            self.handleError(record)


class _Stream(io.TextIOBase):
    """print() e saídas de bibliotecas viram linhas do log (sem console no modo bandeja)."""

    GAP = 0.1  # linhas escritas em sequência (um traceback, por exemplo) viram um registro só

    def __init__(self, logger: logging.Logger, level: int):
        self.logger, self.level, self._buf = logger, level, ""
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None

    def writable(self) -> bool:
        return True

    def write(self, s: str) -> int:
        with self._lock:
            self._buf += s
            if self._timer is None:
                self._timer = threading.Timer(self.GAP, self._emit)
                self._timer.daemon = True
                self._timer.start()
        return len(s)

    def _emit(self) -> None:
        with self._lock:
            self._timer = None
            if "\n" not in self._buf:
                return
            done, self._buf = self._buf.rsplit("\n", 1)
        lines = [ln.rstrip() for ln in done.split("\n")]
        lines = [ln for ln in lines if ln.strip() and set(ln.strip()) != {"-"}]
        if len(lines) == 1:
            self.logger.log(self.level, lines[0])
        elif lines:
            # o resumo na linha; o bloco inteiro fica no detalhe (como um traceback)
            tb = any(ln.startswith("Traceback") for ln in lines)
            head = lines[-1].strip() if tb else lines[0].strip()
            self.logger.log(self.level, "%s", head, extra={"block": "\n".join(lines)})

    def flush(self) -> None:
        pass


# ---------------------------------------------------------------------------- preparar


def log_dir() -> Path:
    from app.windows import winutil

    d = winutil.data_dir() / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def log_file() -> Path:
    return _file or (log_dir() / "app.log")


def setup(console: bool, debug: bool = False) -> Path:
    """Liga o log: arquivo com rotação, memória para o editor e (no terminal) a tela."""
    global _file, _force_debug
    _force_debug = debug
    root = logging.getLogger(ROOT)
    root.setLevel(logging.DEBUG)
    root.propagate = False
    for h in list(root.handlers):
        root.removeHandler(h)
    _file = log_dir() / "app.log"
    flt = _AreaFilter()
    fh = logging.handlers.RotatingFileHandler(_file, maxBytes=MAX_BYTES, backupCount=BACKUPS, encoding="utf-8")
    fh.setFormatter(_Formatter())
    fh.addFilter(flt)
    root.addHandler(fh)
    bh = _Buffer()
    bh.addFilter(flt)
    root.addHandler(bh)
    if console and sys.__stdout__:
        ch = logging.StreamHandler(sys.__stdout__)
        ch.setFormatter(_Formatter(with_date=False))
        ch.addFilter(flt)
        root.addHandler(ch)
    # bibliotecas de fora: só os avisos delas, no mesmo arquivo
    lib = logging.getLogger()
    lib.setLevel(logging.WARNING)
    for h in list(lib.handlers):
        lib.removeHandler(h)
    lib.addHandler(fh)
    lib.addHandler(bh)
    sys.stdout = _Stream(get("stdout"), logging.INFO)
    sys.stderr = _Stream(get("stderr"), logging.WARNING)
    _hooks()
    return _file


def _hooks() -> None:
    """Erro que ninguém tratou (em qualquer thread) vai para o log com o traceback, em vez de sumir."""
    crash = get("crash")

    def excepthook(t, v, tb):
        if issubclass(t, KeyboardInterrupt):
            return sys.__excepthook__(t, v, tb)
        crash.critical("Unhandled error: %s", v, exc_info=(t, v, tb))

    def thread_hook(args):
        if args.exc_type is SystemExit:
            return
        name = args.thread.name if args.thread else "?"
        crash.critical(
            "Unhandled error in thread %r: %s",
            name,
            args.exc_value,
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
        )

    sys.excepthook = excepthook
    threading.excepthook = thread_hook


def configure(settings: dict | None, secrets=()) -> None:
    """Aplica config.logging (na hora, sem reiniciar) e a lista de senhas a esconder."""
    global _detail, _areas
    s = settings if isinstance(settings, dict) else {}
    new_detail = bool(s.get("detail"))
    new_areas = {a for a in (s.get("areas") or []) if a in AREAS}
    changed = (new_detail, new_areas) != (_detail, _areas)
    with _lock:
        _detail, _areas = new_detail, new_areas
        _secrets.clear()
        _secrets.update(x for x in (str(v) for v in secrets if v) if len(x) >= 3)
    if changed:
        get("app").info(
            "Log detail: %s",
            ("detailed (" + ", ".join(sorted(_areas)) + ")")
            if _detail and _areas
            else "detailed (no areas)"
            if _detail
            else "normal",
        )


def setting(settings: dict | None, name: str, default):
    s = settings if isinstance(settings, dict) else {}
    return s.get(name, default)


def startup(config: Path, debug: bool) -> None:
    from app import __version__

    log = get("app")
    log.info("Deck %s starting", __version__)
    log.info(
        "Python %s (%s), Windows %s (%s)",
        platform.python_version(),
        platform.architecture()[0],
        platform.version(),
        platform.machine(),
    )
    log.info("Config: %s", config)
    log.info("Log file: %s%s", log_file(), " (--debug: everything detailed)" if debug else "")


# ---------------------------------------------------------------------------- aba Logs


def records(after: int = 0, limit: int = 1000) -> list[dict]:
    with _lock:
        out = [r for r in _records if r["id"] > after]
    return out[-limit:]


def summary() -> dict:
    """Contagens para o editor: erros novos desde a última visita à aba Logs."""
    with _lock:
        new = sum(1 for r in _records if r["id"] > _seen and r["level"] == "ERROR")
        return {
            "last": _seq,
            "seen": _seen,
            "new_errors": new,
            "errors": _counts["ERROR"],
            "warnings": _counts["WARN"],
            "since": _started,
        }


def mark_seen(upto: int | None = None) -> None:
    global _seen
    with _lock:
        _seen = max(_seen, min(_seq, upto if upto is not None else _seq))


# ---------------------------------------------------------------------------- problemas em aberto


def problem(pid: str, text: str, where: str | None = None, **fmt) -> None:
    """Abre (ou atualiza) um problema que continua. text é a chave em inglês (traduzida na tela)."""
    now = time.time()
    with _lock:
        p = _problems.get(pid)
        new = p is None
        if new:
            p = _problems[pid] = {"id": pid, "since": now, "count": 0}
        changed = new or p.get("text") != text or p.get("fmt") != fmt
        p.update(text=text, fmt=fmt, where=where, last=now)
        p["count"] += 1
    if changed:
        get("problems").warning("Problem: %s", _render(text, fmt), extra={"ctx": {"id": pid}})
    if new:
        _notify("open", pid)


def resolve(pid: str) -> None:
    with _lock:
        p = _problems.pop(pid, None)
    if p:
        get("problems").info("Resolved: %s (after %ds)", _render(p["text"], p["fmt"]), int(time.time() - p["since"]))
        _notify("resolved", pid)


def resolve_prefix(prefix: str) -> None:
    for pid in [k for k in list(_problems) if k.startswith(prefix)]:
        resolve(pid)


def _render(text: str, fmt: dict, translate=False) -> str:
    if translate:
        from app.i18n import tr

        return tr(text, **fmt)
    try:
        return text.format(**fmt)
    except (KeyError, IndexError, ValueError):
        return text


def problems(translate: bool = True) -> list[dict]:
    with _lock:
        items = [dict(p) for p in _problems.values()]
    return [
        {
            "id": p["id"],
            "text": _render(p["text"], p["fmt"], translate),
            "where": p.get("where"),
            "since": p["since"],
            "count": p["count"],
        }
        for p in sorted(items, key=lambda x: x["since"])
    ]


def on_problem(cb) -> None:
    """cb(kind, pid): 'open' quando um problema aparece, 'resolved' quando some."""
    _listeners.append(cb)


def _notify(kind: str, pid: str) -> None:
    for cb in list(_listeners):
        try:
            cb(kind, pid)
        except Exception:
            get("app").debug("Problem listener failed", exc_info=True)


# ---------------------------------------------------------------------------- pacote de diagnóstico


def diagnostics_zip(config_text: str | None, extra: dict | None = None) -> bytes:
    """.zip com os logs, o config (já sem senhas, quem chama tira) e as versões."""
    import json
    import zipfile
    from app import __version__

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        d = log_dir()
        for f in sorted(d.glob("app.log*")):
            try:
                z.writestr(f"logs/{f.name}", mask(f.read_text(encoding="utf-8", errors="replace")))
            except OSError:
                pass
        if config_text is not None:
            z.writestr("config.yaml", mask(config_text))
        info = {
            "app": __version__,
            "python": platform.python_version(),
            "windows": platform.version(),
            "machine": platform.machine(),
            "created": time.strftime("%Y-%m-%d %H:%M:%S"),
            "problems": problems(translate=False),
            **(extra or {}),
        }
        z.writestr("about.json", json.dumps(_mask_obj(info), indent=2, ensure_ascii=False))
    return buf.getvalue()


def files_info() -> dict:
    d = log_dir()
    files = list(d.glob("app.log*"))
    return {
        "folder": str(d),
        "file": str(log_file()),
        "count": len(files),
        "bytes": sum(f.stat().st_size for f in files if f.exists()),
    }
