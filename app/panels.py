"""Painéis prontos do app (os formatos Relógio, Data, Contagem, Medidor, Livre).

Seguem o mesmo formato dos painéis de plugin: para cada tamanho ("linhas x colunas"), uma lista de
linhas com o ícone de cada tecla. "$id" é trocado pelo editor por um id único da tecla (contagens).
"""
from __future__ import annotations

from app.i18n import tr

BG = "#1d2330"


def builtin() -> dict:
    hour = {"text": "{clock.hour}", "style": "info", "text_size": 46, "bg": BG, "edge": ":"}
    minute = {"text": "{clock.minute}", "style": "info", "text_size": 46, "bg": BG}
    day = {"text": "{clock.weekday_short}", "sub": "{clock.day} {clock.month}", "bg": BG}
    timer_cell = {"lucide": "hourglass", "text": "{timer.$id}", "sub": tr("Countdown"), "bg": "#2b2440", "fg": "#ffffff"}
    gauge = {"lucide": "volume-2", "text": "{system.volume}%", "bg": BG,
             "bar": {"value": "system.volume", "min": 0, "max": 100, "color": "#F5A524"}}
    return {
        "app.clock": {"label": tr("Clock"), "icon": "clock", "plugin": None, "sizes": {
            "1x1": [[{"text": "{clock.time}", "sub": "{clock.weekday_short}, {clock.day} {clock.month}", "bg": BG}]],
            "1x2": [[hour, minute]],
            "1x3": [[hour, minute, day]],
            "2x2": [[hour, minute], [{"text": "{clock.weekday}", "style": "info", "bg": BG}, {"text": "{clock.day}", "sub": "{clock.month}", "bg": BG}]],
        }},
        "app.date": {"label": tr("Date"), "icon": "calendar", "plugin": None, "sizes": {
            "1x1": [[{"text": "{clock.day}", "sub": "{clock.weekday_short}, {clock.month}", "bg": BG}]],
            "1x2": [[{"text": "{clock.weekday_short}", "style": "info", "bg": BG}, {"text": "{clock.day}", "sub": "{clock.month}", "bg": BG}]],
        }},
        "app.countdown": {"label": tr("Countdown"), "icon": "hourglass", "plugin": None,
                          "action": {"type": "timer.toggle", "id": "$id", "minutes": 5},
                          "hold": {"type": "timer.reset", "id": "$id"}, "sizes": {
            "1x1": [[timer_cell]],
            "1x2": [[{"lucide": "hourglass", "style": "big", "bg": "#2b2440"},
                     {"text": "{timer.$id}", "sub": tr("Countdown"), "bg": "#2b2440",
                      "bar": {"value": "timer.$id.pct", "color": "#d9ccff"}}]],
        }},
        "app.gauge": {"label": tr("Gauge"), "icon": "gauge", "plugin": None, "sizes": {
            "1x1": [[gauge]],
            "1x2": [[{"lucide": "volume-2", "style": "big", "bg": BG}, {**gauge, "lucide": None}]],
        }},
        "app.free": {"label": tr("Free value"), "icon": "braces", "plugin": None, "sizes": {
            "1x1": [[{"text": "{deck.page}", "sub": tr("page"), "bg": BG}]],
        }},
    }
