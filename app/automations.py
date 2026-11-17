"""Automações: "quando acontecer X, fazer Y", sem apertar tecla.

No config:
  automations:
    - name: Quando a live começar
      enabled: true
      when: {type: value, value: obs.streaming, op: eq, to: true}
      do: [{type: light.flash, color: "#22c55e", seconds: 3}]
      cooldown: 30            # não roda de novo antes de N segundos
      days: all               # all | weekdays | weekend

Gatilhos ('when.type'):
  time       at: "18:00"            todo dia nessa hora
  every      minutes: 60            a cada N minutos (desde que o app abriu)
  countdown  minutes: 25            uma vez, N minutos depois que o app abriu (ou a automação foi ligada)
  value      value/op/to            quando a condição passa a valer (de falsa para verdadeira)
  connected                         quando o Deck conecta
  page       page: main             ao entrar numa página
Rodam só enquanto o app está aberto.
"""

from __future__ import annotations

import time

from app import actions, logs, values
from app.i18n import tr

log = logs.get("automations")

TYPES = ("time", "every", "countdown", "value", "connected", "page")


def validate(a, where: str) -> list[str]:
    if not isinstance(a, dict):
        return [tr("{where}: expected an object with when/do", where=where)]
    errs = []
    when = a.get("when")
    if not isinstance(when, dict) or when.get("type") not in TYPES:
        errs.append(tr("{where}.when: use one of: {options}", where=where, options=", ".join(TYPES)))
        return errs
    t = when["type"]
    if t == "time":
        try:
            hh, mm = str(when.get("at", "")).split(":")
            if not (0 <= int(hh) < 24 and 0 <= int(mm) < 60):
                raise ValueError
        except ValueError:
            errs.append(tr("{where}.when.at: a time like 18:00", where=where))
    elif t in ("every", "countdown"):
        m = when.get("minutes")
        if not isinstance(m, (int, float)) or m <= 0:
            errs.append(tr("{where}.when.minutes: a number of minutes", where=where))
    elif t == "value":
        errs += values.check_cond(when, f"{where}.when")
    elif t == "page" and not when.get("page"):
        errs.append(tr("{where}.when.page: which page", where=where))
    if a.get("days") not in (None, "all", "weekdays", "weekend"):
        errs.append(tr("{where}.days: use all, weekdays or weekend", where=where))
    errs += actions.validate(a.get("do"), f"{where}.do")
    return errs


class Automations:
    def __init__(self, engine):
        self.engine = engine
        self.items: list[dict] = []
        self._state: dict[int, dict] = {}
        self._last_tick = 0.0

    def configure(self, items: list[dict]) -> None:
        now = time.monotonic()
        old = {self._key(a): st for a, st in zip(self.items, self._state.values())}
        self.items = [a for a in items if isinstance(a, dict)]
        self._state = {}
        for i, a in enumerate(self.items):
            st = old.get(self._key(a))
            # automação nova (ou mudada): contagem e "a cada" começam agora; condição começa como está
            self._state[i] = (
                st if st is not None else {"since": now, "last": None, "prev": None, "fired_day": None, "done": False}
            )

    @staticmethod
    def _key(a: dict) -> str:
        return repr((a.get("name"), a.get("when"), a.get("enabled", True)))

    def _blocked(self, a: dict, st: dict, now: float) -> str | None:
        """Por que a automação não pode rodar agora (None = pode)."""
        if a.get("enabled", True) is False:
            return "it's turned off"
        days = a.get("days") or "all"
        wd = time.localtime().tm_wday
        if (days == "weekdays" and wd >= 5) or (days == "weekend" and wd < 5):
            return f"not today (days: {days})"
        cd = a.get("cooldown") or 0
        if st["last"] is not None and now - st["last"] < float(cd):
            return f"cooldown, {float(cd) - (now - st['last']):.0f} s left"
        return None

    def _allowed(self, a: dict, st: dict, now: float) -> bool:
        return self._blocked(a, st, now) is None

    @staticmethod
    def _name(a: dict, i: int) -> str:
        return str(a.get("name") or f"#{i + 1}")

    def _fire(self, i: int, now: float) -> None:
        a, st = self.items[i], self._state[i]
        name = self._name(a, i)
        why = self._blocked(a, st, now)
        if why is not None:
            log.debug("Automation '%s' triggered (%s) but didn't run: %s", name, (a.get("when") or {}).get("type"), why)
            return
        st["last"] = now
        log.info("Automation ran: '%s' (trigger: %s)", name, (a.get("when") or {}).get("type"))
        self.engine._submit(a.get("do"), 0, "automation", name)

    def tick(self) -> None:
        """Chamado pelo engine; confere os gatilhos de tempo e de valor uma vez por segundo."""
        now = time.monotonic()
        if now - self._last_tick < 1.0:
            return
        self._last_tick = now
        lt = time.localtime()
        for i, a in enumerate(self.items):
            st, w = self._state[i], a.get("when") or {}
            t = w.get("type")
            if t == "time":
                if f"{lt.tm_hour:02d}:{lt.tm_min:02d}" == _hhmm(w.get("at")) and st["fired_day"] != lt.tm_yday:
                    st["fired_day"] = lt.tm_yday
                    self._fire(i, now)
            elif t == "every":
                if now - st["since"] >= float(w.get("minutes", 0)) * 60:
                    st["since"] = now
                    self._fire(i, now)
            elif t == "countdown":
                if not st["done"] and now - st["since"] >= float(w.get("minutes", 0)) * 60:
                    st["done"] = True
                    self._fire(i, now)
            elif t == "value":
                cur = values.test(w, self.engine.values.get)
                if cur != st["prev"]:
                    log.debug(
                        "Automation '%s': condition %s %s %r is now %s%s",
                        self._name(a, i),
                        w.get("value"),
                        w.get("op") or "eq",
                        w.get("to"),
                        cur,
                        " (first reading: only noted)"
                        if st["prev"] is None
                        else ""
                        if cur
                        else " (doesn't run: it runs when it turns true)",
                    )
                if cur and st["prev"] is False:  # passou a valer (na primeira leitura só anota)
                    self._fire(i, now)
                st["prev"] = cur

    def on_connected(self) -> None:
        now = time.monotonic()
        for i, a in enumerate(self.items):
            if (a.get("when") or {}).get("type") == "connected":
                self._fire(i, now)

    def on_page(self, page: str) -> None:
        now = time.monotonic()
        for i, a in enumerate(self.items):
            w = a.get("when") or {}
            if w.get("type") == "page" and str(w.get("page")) == page:
                self._fire(i, now)


def _hhmm(at) -> str:
    try:
        hh, mm = str(at).split(":")
        return f"{int(hh):02d}:{int(mm):02d}"
    except ValueError:
        return ""
