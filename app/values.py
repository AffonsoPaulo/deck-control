"""Valores: informações vivas que teclas, regras, condições e automações podem usar.

Cada valor tem um id ("clock.hour", "obs.streaming", "weather.temp"…). De onde vêm:
  - do próprio app: relógio e data, página atual, brilho, volume do Windows, contagens;
  - dos estados (liga/desliga) que o app já conhece: "obs.recording", "discord.mute"…;
  - dos plugins: PluginAPI.set_value / mensagem {"type": "value"} dos externos.

Textos usam {id} e, se quiser, um formato: {clock.minute|nz} (sem zero na frente).
Condições: {"value": "obs.streaming", "op": "eq", "to": true}.
"""
from __future__ import annotations

import re
import threading
import time

from app import logs
from app.i18n import tr

log = logs.get("values")
_MISSING = object()
TOKEN = re.compile(r"\{([A-Za-z0-9_.:\-]+)(?:\|([a-z0-9]+))?\}")

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
WEEKDAYS_SHORT = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MONTHS_SHORT = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

# valores do app: id -> (rótulo em inglês, grupo, tipo, exemplo)
BUILTIN = [
    ("clock.hour", "Hour", "Clock and date", "text", "14"),
    ("clock.minute", "Minute", "Clock and date", "text", "32"),
    ("clock.second", "Second", "Clock and date", "text", "08"),
    ("clock.time", "Time (hh:mm)", "Clock and date", "text", "14:32"),
    ("clock.weekday", "Day of the week", "Clock and date", "text", "Saturday"),
    ("clock.weekday_short", "Day of the week (short)", "Clock and date", "text", "Sat"),
    ("clock.day", "Day", "Clock and date", "text", "15"),
    ("clock.month", "Month", "Clock and date", "text", "nov"),
    ("clock.date", "Date", "Clock and date", "text", "15/11/2026"),
    ("system.volume", "Windows volume", "System", "number", 62),
    ("system.muted", "Windows sound muted", "System", "bool", False),
    ("deck.page", "Current page", "System", "text", "main"),
    ("deck.brightness", "Screen brightness", "System", "number", 80),
]
FORMATS = {"nz": "no leading zero", "up": "uppercase", "low": "lowercase"}
OPS = ("eq", "ne", "gt", "lt", "ge", "le", "contains")


def _fmt(v, f) -> str:
    if v is None:
        return "–"
    if isinstance(v, bool):
        s = tr("yes") if v else tr("no")
    elif isinstance(v, float):
        s = f"{v:.0f}" if v.is_integer() else f"{v:.1f}"
    else:
        s = str(v)
    if f == "nz":
        s = s.lstrip("0") or "0"
    elif f == "up":
        s = s.upper()
    elif f == "low":
        s = s.lower()
    return s


def has_tokens(text) -> bool:
    return isinstance(text, str) and bool(TOKEN.search(text))


def render(text, get) -> str:
    """'{clock.hour}:{clock.minute}' -> '14:32'."""
    if not isinstance(text, str):
        return text
    return TOKEN.sub(lambda m: _fmt(get(m.group(1)), m.group(2)), text)


def single(text, get):
    """Se o texto é só um token ('{weather.icon}'), devolve o valor cru (para ícone, cor, imagem)."""
    if isinstance(text, str):
        m = TOKEN.fullmatch(text.strip())
        if m:
            v = get(m.group(1))
            return None if v is None else _fmt(v, m.group(2)) if m.group(2) else v
    return text


def _num(v):
    if isinstance(v, bool):
        return float(v)
    try:
        return float(str(v).replace("%", "").replace("°", "").replace(",", "."))
    except (TypeError, ValueError):
        return None


def test(cond, get) -> bool:
    """{"value": id, "op": "eq", "to": x} -> bool. Sem 'op': o valor é verdadeiro?"""
    if not isinstance(cond, dict) or not cond.get("value"):
        return False
    v = get(str(cond["value"]))
    op = cond.get("op") or ("eq" if "to" in cond else None)
    if op is None:
        return bool(v) and v not in ("0", "no", "false")
    to = cond.get("to")
    if isinstance(to, bool) or isinstance(v, bool):
        truthy = lambda x: str(x).lower() in ("true", "1", "yes", "sim", "on") if not isinstance(x, bool) else x
        a, b = truthy(v), truthy(to)
        return (a == b) if op == "eq" else (a != b) if op == "ne" else False
    if op == "contains":
        return str(to).lower() in str(v).lower()
    if op in ("eq", "ne"):
        na, nb = _num(v), _num(to)
        same = (na == nb) if na is not None and nb is not None else str(v).strip().lower() == str(to).strip().lower()
        return same if op == "eq" else not same
    na, nb = _num(v), _num(to)
    if na is None or nb is None:
        return False
    return {"gt": na > nb, "lt": na < nb, "ge": na >= nb, "le": na <= nb}[op]


def check_cond(cond, where: str) -> list[str]:
    if not isinstance(cond, dict) or not cond.get("value"):
        return [tr("{where}: a condition needs 'value'", where=where)]
    if cond.get("op") not in (None, *OPS):
        return [tr("{where}: unknown operator '{op}' (use {ops})", where=where, op=cond.get("op"), ops=", ".join(OPS))]
    return []


def band_color(v, bands, default=None):
    """bands = [[até, cor], ...] em ordem crescente: a primeira faixa que cobre o valor."""
    n = _num(v)
    if n is None or not isinstance(bands, list):
        return default
    for b in bands:
        try:
            if n <= float(b[0]):
                return b[1]
        except (TypeError, ValueError, IndexError):
            continue
    return bands[-1][1] if bands and isinstance(bands[-1], (list, tuple)) and len(bands[-1]) > 1 else default


class Values:
    """Valores do app, dos estados e dos plugins. Seguro para várias threads."""

    def __init__(self, engine=None):
        self.engine = engine
        self._lock = threading.Lock()
        self._plugin: dict[str, object] = {}
        self._timers: dict[str, dict] = {}
        self._vol = (None, 0.0)        # (valor, hora da leitura): o volume é lido no máximo a cada 1 s

    # -- plugins
    def set(self, name: str, value) -> None:
        with self._lock:
            old = self._plugin.get(name, _MISSING)
            self._plugin[name] = value
        if not callable(value) and (old is _MISSING or callable(old) or old != value):
            log.debug("Value %s: %r -> %r", name, None if old is _MISSING or callable(old) else old, value)

    def forget_prefix(self, prefix: str) -> None:
        with self._lock:
            for k in [k for k in self._plugin if k.startswith(prefix)]:
                del self._plugin[k]

    # -- contagens (format "Contagem")
    def timer_toggle(self, tid: str, seconds: float) -> None:
        now = time.monotonic()
        with self._lock:
            t = self._timers.get(tid)
            if t is None or t["left"] <= 0 and t["since"] is None:
                self._timers[tid] = {"total": seconds, "left": seconds, "since": now}
            elif t["since"] is None:
                t["since"] = now                                         # continua
            else:
                t["left"] = max(0.0, t["left"] - (now - t["since"]))     # pausa
                t["since"] = None

    def timer_reset(self, tid: str, seconds: float | None = None) -> None:
        with self._lock:
            old = self._timers.get(tid) or {}
            total = seconds if seconds is not None else old.get("total", 0)
            self._timers[tid] = {"total": total, "left": total, "since": None}

    def _timer(self, tid: str):
        t = self._timers.get(tid)
        if not t:
            return None
        left = t["left"] - (time.monotonic() - t["since"]) if t["since"] is not None else t["left"]
        return max(0.0, left), t

    # -- leitura
    def get(self, name: str):
        if name.startswith("clock."):
            return self._clock(name[6:])
        if name.startswith("timer."):
            parts = name.split(".")
            got = self._timer(parts[1]) if len(parts) > 1 else None
            if got is None:
                return None
            left, t = got
            what = parts[2] if len(parts) > 2 else ""
            if what == "running":
                return t["since"] is not None and left > 0
            if what == "pct":
                return round(100 * left / t["total"]) if t["total"] else 0
            s = int(left + 0.999)
            return f"{s // 60:02d}:{s % 60:02d}"
        if name == "system.volume" or name == "system.muted":
            return self._volume(name)
        e = self.engine
        if name == "deck.page":
            return e.page if e else None
        if name == "deck.brightness":
            return getattr(e, "_brightness", None) if e else None
        with self._lock:
            v = self._plugin.get(name, _MISSING)
        if v is not _MISSING:
            if callable(v):
                try:
                    return v()
                except Exception:      # valor calculado na hora (ex.: tempo de live); lido a cada desenho, sem log
                    return None
            return v
        if e is not None and name in getattr(e, "_states", {}):
            return e.get_state(name)
        return None

    def _clock(self, what: str):
        t = time.localtime()
        return {
            "hour": f"{t.tm_hour:02d}", "minute": f"{t.tm_min:02d}", "second": f"{t.tm_sec:02d}",
            "time": f"{t.tm_hour:02d}:{t.tm_min:02d}",
            "weekday": tr(WEEKDAYS[t.tm_wday]), "weekday_short": tr(WEEKDAYS_SHORT[t.tm_wday]),
            "day": str(t.tm_mday), "month": tr(MONTHS_SHORT[t.tm_mon - 1]),
            "date": tr("{m}/{d}/{y}", d=f"{t.tm_mday:02d}", m=f"{t.tm_mon:02d}", y=t.tm_year),
        }.get(what)

    def _volume(self, name: str):
        val, at = self._vol
        if time.monotonic() - at > 1.0:
            try:
                from app import winutil
                val = winutil.master_volume()
            except Exception:          # lido toda hora para as teclas; sem áudio = sem valor, sem log
                val = None
            self._vol = (val, time.monotonic())
        if val is None:
            return None
        return val[1] if name == "system.muted" else val[0]

    def snapshot(self, ids) -> dict:
        return {i: self.get(i) for i in ids}

    def needs_seconds(self, text: str) -> bool:
        """Textos com segundos ou contagens precisam ser redesenhados a cada segundo."""
        return isinstance(text, str) and ("{clock.second" in text or "{timer." in text)


def _ref(ref, get):
    ref = str(ref or "")
    return single(ref, get) if "{" in ref else get(ref)


def resolve_icon(icon: dict, get) -> dict:
    """Troca os {valores} do ícone pelo que vale agora: texto, ícone/imagem/cor vindos de valor,
    barra (porcentagem e cor por faixa) e fundo por faixa."""
    out = {}
    for k, v in icon.items():
        if k in ("text", "sub"):
            out[k] = render(v, get)
        elif k == "bar" and isinstance(v, dict):
            n = _num(_ref(v.get("value"), get))
            try:
                lo, hi = float(v.get("min", 0) or 0), float(v.get("max", 100) or 100)
            except (TypeError, ValueError):
                lo, hi = 0.0, 100.0
            pct = 0 if n is None or hi == lo else (n - lo) * 100 / (hi - lo)
            color = band_color(n, v.get("bands"), v.get("color")) if v.get("bands") else v.get("color")
            out[k] = {"pct": pct, "color": color or "#F5A524"}
        elif k == "bg" and isinstance(v, dict):
            out[k] = band_color(_ref(v.get("value"), get), v.get("bands"), v.get("default")) or v.get("default") or "#1d2330"
        elif isinstance(v, str) and "{" in v:
            r = single(v, get)
            out[k] = render(v, get) if isinstance(r, str) and "{" in r else r
        else:
            out[k] = v
    return out


VALUES = Values()          # um só para o app inteiro (o engine se registra nele)


def describe() -> list[dict]:
    """Os valores do app para o editor (os de plugins vêm do MANAGER)."""
    return [{"id": i, "label": label, "group": group, "kind": kind, "sample": sample}
            for i, label, group, kind, sample in BUILTIN]
