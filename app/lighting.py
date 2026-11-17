"""Luz do D6: o anel de 18 LEDs em volta do aparelho.

O D6 não tem efeitos que dê para escolher por software: ele aceita a cor de cada LED
(d6.device.D6.set_leds) e guarda até o próximo envio. Os efeitos são animados aqui,
a uns 30 quadros por segundo, e as reações às teclas são desenhadas por cima.

Config (seção opcional `lighting:`; sem ela o app não mexe na luz):

    lighting:
      effect: comet            # ver EFFECTS
      color: "#F5A524"         # cor principal (cor fixa, respirar, cometa...)
      color2: "#E5701A"        # segunda cor (degradê)
      speed: 50                # 0 a 100
      size: 50                 # rastro do cometa, quantidade de estrelas/faíscas (0 a 100)
      direction: cw            # cw (horário) | ccw (anti-horário)
      brightness: 80           # 0 a 100
      per_page: false          # true: cada página pode ter a sua (em pages:)
      off_with_screen: true    # apaga quando a tela do PC desliga ou o Windows é bloqueado
      reaction:                # reação padrão das teclas, ao apertar
        kind: ripple           # none | ripple (onda) | point (ponto) | pulse (pulso)
        color: key             # key (cor de fundo da tecla) | fixed | effect
        fixed: "#F5A524"
        speed: 50
        reach: 100             # até onde a onda vai (100 = o anel todo)
      pages:
        obs: {effect: breath, color: "#E5484D"}

Em cada tecla, `light:` muda a reação dela em cada momento (tem prioridade sobre a padrão):

    light:
      press:   {kind: ripple, color: fixed, fixed: "#E5484D"}
      hold:    {kind: hold}    # acesa enquanto segura (só no hold)
      release: {kind: default}
"""

from __future__ import annotations

import colorsys
import math
import random

from d6.device import COLS, LED_COUNT, ROWS
from app.i18n import tr

N = LED_COUNT
EFFECTS = (
    "off",
    "solid",
    "breath",
    "beat",
    "aurora",
    "candle",
    "rainbow",
    "wave",
    "grad",
    "comet",
    "chase",
    "theater",
    "fill",
    "stars",
    "sparks",
)
REACTIONS = ("none", "ripple", "point", "pulse")  # padrão e por tecla
KEY_REACTIONS = REACTIONS + ("default", "hold")  # só por tecla ('hold' só no momento hold)
COLOR_MODES = ("key", "fixed", "effect")
MOMENTS = ("press", "hold", "release")
AMBER = "#F5A524"

DEFAULTS = {
    "effect": "solid",
    "color": AMBER,
    "color2": "#E5701A",
    "speed": 50,
    "size": 50,
    "direction": "cw",
    "brightness": 80,
    "per_page": False,
    "off_with_screen": True,
    "reaction": {"kind": "ripple", "color": "key", "fixed": AMBER, "speed": 50, "reach": 100},
}
EFFECT_KEYS = ("effect", "color", "color2", "speed", "size", "direction")  # o que uma página pode trocar


# ------------------------------------------------------------------ validação (usada por app.config)


def _is_hex(v) -> bool:
    return isinstance(v, str) and len(v) == 7 and v[0] == "#" and all(c in "0123456789abcdefABCDEF" for c in v[1:])


def _check_reaction(r, where: str, kinds) -> list[str]:
    if r is None:
        return []
    if not isinstance(r, dict):
        return [tr("{where}: expected an object with kind/color", where=where)]
    errs = []
    if r.get("kind", "default" if kinds is KEY_REACTIONS else "ripple") not in kinds:
        errs.append(tr("{where}.kind: use one of: {options}", where=where, options=", ".join(kinds)))
    if "color" in r and r["color"] not in COLOR_MODES:
        errs.append(tr("{where}.color: use key, fixed or effect", where=where))
    if "fixed" in r and not _is_hex(r["fixed"]):
        errs.append(tr("{where}.fixed: color in the #RRGGBB format", where=where))
    return errs


def _check_effect(d: dict, where: str) -> list[str]:
    errs = []
    if "effect" in d and d["effect"] not in EFFECTS:
        errs.append(tr("{where}.effect: unknown effect '{effect}'", where=where, effect=d["effect"]))
    for c in ("color", "color2"):
        if c in d and not _is_hex(d[c]):
            errs.append(tr("{where}.{field}: color in the #RRGGBB format", where=where, field=c))
    if "direction" in d and d["direction"] not in ("cw", "ccw"):
        errs.append(tr("{where}.direction: use cw or ccw", where=where))
    return errs


def validate(section, where: str = "lighting") -> list[str]:
    if section is None:
        return []
    if not isinstance(section, dict):
        return [tr("{where}: expected an object", where=where)]
    errs = _check_effect(section, where)
    errs += _check_reaction(section.get("reaction"), f"{where}.reaction", REACTIONS)
    pages = section.get("pages") or {}
    if not isinstance(pages, dict):
        errs.append(tr("{where}.pages: expected an object (page: effect)", where=where))
    else:
        for name, p in pages.items():
            if not isinstance(p, dict):
                errs.append(tr("{where}: expected an object", where=f"{where}.pages.{name}"))
            else:
                errs += _check_effect(p, f"{where}.pages.{name}")
    return errs


def validate_key(light, where: str) -> list[str]:
    if light is None:
        return []
    if not isinstance(light, dict):
        return [tr("{where}: expected an object with press/hold/release", where=where)]
    errs = []
    for m, r in light.items():
        if m not in MOMENTS:
            errs.append(tr("{where}: unknown moment '{moment}' (use press, hold or release)", where=where, moment=m))
            continue
        errs += _check_reaction(r, f"{where}.{m}", KEY_REACTIONS)
        if isinstance(r, dict) and r.get("kind") == "hold" and m != "hold":
            errs.append(tr("{where}: 'lit while held' only exists in the hold moment", where=f"{where}.{m}"))
    return errs


# ------------------------------------------------------------------ geometria: em que LED cada tecla fica


def _ring_points(w=520.0, h=330.0, r=40.0, inset=15.0):
    """N pontos na borda de um retângulo arredondado: começa embaixo no meio, sentido horário."""
    x0, y0, x1, y1 = inset, inset, w - inset, h - inset
    rr = r - inset
    segs = []

    def line(ax, ay, bx, by):
        segs.append((math.hypot(bx - ax, by - ay), lambda t: (ax + (bx - ax) * t, ay + (by - ay) * t)))

    def arc(cx, cy, a0, a1):
        segs.append(
            (
                abs(a1 - a0) * rr,
                lambda t: (cx + rr * math.cos(a0 + (a1 - a0) * t), cy + rr * math.sin(a0 + (a1 - a0) * t)),
            )
        )

    cx = (x0 + x1) / 2
    line(cx, y1, x0 + rr, y1)
    arc(x0 + rr, y1 - rr, math.pi / 2, math.pi)
    line(x0, y1 - rr, x0, y0 + rr)
    arc(x0 + rr, y0 + rr, math.pi, 1.5 * math.pi)
    line(x0 + rr, y0, x1 - rr, y0)
    arc(x1 - rr, y0 + rr, 1.5 * math.pi, 2 * math.pi)
    line(x1, y0 + rr, x1, y1 - rr)
    arc(x1 - rr, y1 - rr, 0, math.pi / 2)
    line(x1 - rr, y1, cx, y1)
    total = sum(s[0] for s in segs)
    pts = []
    for i in range(N):
        d = total * i / N
        for length, f in segs:
            if d <= length or (length, f) == segs[-1]:
                pts.append(f(min(1.0, d / length if length else 0)))
                break
            d -= length
    return pts


def _key_leds() -> dict[int, int]:
    ks, gap, w, h = 76, 14, 520, 330
    gx, gy = (w - (COLS * ks + (COLS - 1) * gap)) / 2, (h - (ROWS * ks + (ROWS - 1) * gap)) / 2
    pts = _ring_points()
    out = {}
    for k in range(1, COLS * ROWS + 1):
        row, col = divmod(k - 1, COLS)
        x, y = gx + col * (ks + gap) + ks / 2, gy + row * (ks + gap) + ks / 2
        out[k] = min(range(N), key=lambda i: math.hypot(pts[i][0] - x, pts[i][1] - y))
    return out


KEY_LED = _key_leds()


# ------------------------------------------------------------------ cores


def rgb(hexstr: str) -> tuple[float, float, float]:
    try:
        return tuple(int(hexstr[i : i + 2], 16) for i in (1, 3, 5))
    except (TypeError, ValueError, IndexError):
        return (245, 165, 36)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def scale(c, k):
    return tuple(v * k for v in c)


# As cores do config são de tela (já ajustadas para o olho); o LED acende linear. Sem converter, as "sobras" de
# uma cor misturada aparecem demais (o verde #22c55e puxava para o ciano, o vermelho #e5484d para o rosa).
# A correção vale só para a proporção entre os canais: o principal fica com o brilho de antes (corrigir todos
# deixava o anel apagado) e os outros encolhem com a curva 2,8. Escolhido comparando no D6 (página de teste
# "cores", 2026-11-17): corrigir tudo (apagado), manter o brilho com 2,8 (o melhor) e com 2,2 (puxava para o ciano).
GAMMA = 2.8


def to_led(c):
    """Cor de tela (0-255 por canal) -> o valor que o LED precisa para parecer essa cor: o canal mais forte
    fica igual e cada outro vira principal x (canal / principal) ^ 2,8."""
    ch = [max(0.0, min(255.0, float(v))) for v in c]
    m = max(ch)
    if m <= 0:
        return (0, 0, 0)
    return tuple(int(round(m * (v / m) ** GAMMA)) for v in ch)


def hsv(h, s=1.0, v=1.0):
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, s, v)
    return (r * 255, g * 255, b * 255)


BLACK = (0.0, 0.0, 0.0)
WHITE = (255.0, 255.0, 255.0)
AURORA = [rgb(c) for c in ("#14b8a6", "#22c55e", "#0ea5e9", "#6366f1")]
CANDLE = [rgb(c) for c in ("#ff7a00", "#ffa000", "#ffc040")]


def _palette(pal, t):
    t %= 1.0
    x = t * len(pal)
    i = int(x)
    return mix(pal[i % len(pal)], pal[(i + 1) % len(pal)], x - i)


def ring_dist(a: int, b: int) -> int:
    d = abs(a - b) % N
    return min(d, N - d)


# ------------------------------------------------------------------ o motor


class Lighting:
    def __init__(self):
        self.section: dict | None = None
        self.reacts: list[dict] = []
        self._held: dict[int, dict] = {}  # tecla -> {t0, spec, color, fired}
        self._sparks: list[list[float]] = []  # [led, início]
        self._last_t: float | None = None
        rnd = random.Random(6)
        self._star = [(rnd.uniform(1.8, 3.6), rnd.uniform(0, 6.28)) for _ in range(N)]
        self._candle = [(rnd.uniform(0, 6.28), rnd.uniform(0.7, 1.3)) for _ in range(N)]

    # -- config
    def configure(self, section) -> None:
        self.section = section if isinstance(section, dict) else None

    @property
    def enabled(self) -> bool:
        return self.section is not None

    def settings(self, page: str) -> dict:
        s = {**DEFAULTS, **(self.section or {})}
        s["reaction"] = {**DEFAULTS["reaction"], **((self.section or {}).get("reaction") or {})}
        if s.get("per_page"):
            p = ((self.section or {}).get("pages") or {}).get(page) or {}
            s.update({k: p[k] for k in EFFECT_KEYS if k in p})
        return s

    # -- teclas
    def on_key(self, key: int, pressed: bool, light: dict | None, key_color: str | None, page: str, now: float) -> None:
        if not self.enabled:
            return
        if pressed:
            self._held[key] = {"t0": now, "light": light or {}, "color": key_color, "fired": False}
            self._react(key, "press", light, key_color, page, now)
        else:
            h = self._held.pop(key, None)
            for r in self.reacts:
                if r["key"] == key and r["kind"] == "hold" and r.get("end") is None:
                    r["end"] = now
            self._react(key, "release", (h or {}).get("light", light), key_color, page, now)

    def check_holds(self, hold_ms_of, page: str, now: float) -> None:
        for key, h in self._held.items():
            if not h["fired"] and (now - h["t0"]) * 1000 >= hold_ms_of(key):
                h["fired"] = True
                self._react(key, "hold", h["light"], h["color"], page, now)

    def _react(self, key, moment, light, key_color, page, now) -> None:
        spec = (light or {}).get(moment) or {}
        kind = spec.get("kind", "default")
        if kind == "default":
            if moment != "press":  # a reação padrão vale só ao apertar
                return
            spec = self.settings(page)["reaction"]
            kind = spec.get("kind", "ripple")
        if kind == "none":
            return
        base = self.settings(page)["reaction"]
        color = self._reaction_color(
            spec.get("color", base.get("color", "key")), spec.get("fixed", base.get("fixed", AMBER)), key_color, page
        )
        self.reacts.append(
            {
                "key": key,
                "led": KEY_LED.get(key, 0),
                "kind": kind,
                "t0": now,
                "color": color,
                "speed": float(spec.get("speed", base.get("speed", 50))),
                "reach": float(spec.get("reach", base.get("reach", 100))),
                "end": None,
            }
        )
        self.reacts = self.reacts[-24:]

    def _reaction_color(self, mode, fixed, key_color, page):
        if mode == "fixed":
            return rgb(fixed)
        if mode == "effect":
            s = self.settings(page)
            return WHITE if s["effect"] in ("rainbow", "wave", "aurora", "candle", "off") else rgb(s["color"])
        c = rgb(key_color) if key_color else None
        # tecla sem cor ou quase preta: usa o âmbar, senão a reação nem aparece
        if c is None or (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) < 40:
            return rgb(AMBER)
        return c

    # -- um quadro
    def frame(self, page: str, now: float) -> list[tuple[int, int, int]]:
        s = self.settings(page)
        dt = 0.0 if self._last_t is None else max(0.0, min(0.2, now - self._last_t))
        self._last_t = now
        cols = self._effect(s, now, dt)
        cols = self._reactions(cols, now)
        # o quadro sai em cores de tela; quem manda ao LED converte (to_led, que mantém o canal principal: o
        # brilho daqui passa igual para o LED)
        k = (max(0, min(100, float(s.get("brightness", 80)))) / 100) ** 1.6
        return [tuple(int(max(0, min(255, round(v * k)))) for v in c) for c in cols]

    def animating(self, page: str) -> bool:
        """Se o quadro muda com o tempo (senão basta reenviar de vez em quando)."""
        return self.settings(page)["effect"] not in ("off", "solid") or bool(self.reacts)

    def _effect(self, s, t, dt):
        eff = s["effect"]
        sp = 0.3 + max(0.0, min(100.0, float(s.get("speed", 50)))) / 100 * 1.7
        size = max(0.0, min(100.0, float(s.get("size", 50)))) / 100
        d = 1 if s.get("direction", "cw") == "cw" else -1
        c1, c2 = rgb(s.get("color", AMBER)), rgb(s.get("color2", "#E5701A"))
        if eff == "off":
            return [BLACK] * N
        if eff == "solid":
            return [c1] * N
        if eff == "breath":
            k = 0.12 + 0.88 * (0.5 - 0.5 * math.cos(2 * math.pi * t * sp / 3.2))
            return [scale(c1, k)] * N
        if eff == "beat":
            ph = (t * sp / 1.6) % 1.0
            k = 0.12 + 0.88 * max(math.exp(-(((ph - 0.08) / 0.05) ** 2)), 0.85 * math.exp(-(((ph - 0.28) / 0.06) ** 2)))
            return [scale(c1, k)] * N
        if eff == "aurora":
            return [_palette(AURORA, t * sp / 9 + d * i / N) for i in range(N)]
        if eff == "candle":
            out = []
            for i in range(N):
                ph, f = self._candle[i]
                n = 0.5 + 0.25 * math.sin(t * 7.1 * f * sp + ph) + 0.25 * math.sin(t * 12.7 * f * sp + 2 * ph)
                out.append(scale(_palette(CANDLE, n * 0.66), 0.55 + 0.45 * n))
            return out
        if eff == "rainbow":
            return [hsv(t * sp / 6)] * N
        if eff == "wave":
            return [hsv(t * sp / 4 - d * i / N) for i in range(N)]
        if eff == "grad":
            return [mix(c1, c2, 0.5 - 0.5 * math.cos(2 * math.pi * (i / N - d * t * sp / 6))) for i in range(N)]
        if eff in ("comet", "chase"):
            heads = (
                [(t * sp / 1.8 * N) % N] if eff == "comet" else [(t * sp / 2.4 * N) % N, (t * sp / 2.4 * N + N / 2) % N]
            )
            trail = 2 + size * 10 if eff == "comet" else 3.0
            color = c1
            out = []
            for i in range(N):
                pos = i if d == 1 else (N - i) % N
                k = 0.0
                for hd in heads:
                    behind = (hd - pos) % N
                    k = max(k, max(0.0, 1 - behind / trail))
                c = scale(color, k)
                if k > 0.9:
                    c = mix(c, WHITE, (k - 0.9) * 4)
                out.append(c)
            return out
        if eff == "theater":
            step = int(t * sp * 3.3)
            return [c1 if ((i * d) - step) % 3 == 0 else BLACK for i in range(N)]
        if eff == "fill":
            ph = (t * sp / 4) % 1.0
            out = []
            for i in range(N):
                pos = (i if d == 1 else (N - i) % N) / N
                on = pos < ph * 2 if ph < 0.5 else pos >= (ph - 0.5) * 2
                out.append(c1 if on else BLACK)
            return out
        if eff == "stars":
            out = []
            dens = 0.35 + size * 0.65
            for i in range(N):
                per, ph = self._star[i]
                k = max(0.0, math.sin(2 * math.pi * t * sp / per + ph)) ** 3
                if (i * 7919 % 100) / 100 > dens:
                    k = 0.0
                out.append(scale(mix(rgb("#f5f0dc"), c1, 0.35), k))
            return out
        if eff == "sparks":
            rate = (2 + size * 12) * sp
            if dt > 0 and random.random() < rate * dt:
                self._sparks.append([random.randrange(N), t])
            self._sparks = [x for x in self._sparks if t - x[1] < 0.6]
            out = [BLACK] * N
            for led, t0 in self._sparks:
                k = max(0.0, 1 - (t - t0) / 0.6)
                c = mix(scale(c1, k), WHITE, k * 0.5)
                out[int(led)] = tuple(max(a, b) for a, b in zip(out[int(led)], c))
            return out
        return [c1] * N

    def _reactions(self, cols, now):
        keep = []
        for r in self.reacts:
            e = now - r["t0"]
            v = 8 + r["speed"] / 100 * 28  # LEDs por segundo
            dur = 0.35 + (1 - r["speed"] / 100) * 0.6
            reach = max(1, round(r["reach"] / 100 * (N // 2)))
            done = False
            for i in range(N):
                dd = ring_dist(i, r["led"])
                k = 0.0
                if r["kind"] == "ripple":
                    x = e * v - dd
                    if dd <= reach and x >= 0:
                        k = max(0.0, 1 - x / 3.0) * (1 - 0.4 * dd / (reach + 1))
                    done = e * v - reach > 3.0
                elif r["kind"] in ("point", "pulse"):
                    k = max(0.0, 1 - e / dur)
                    if r["kind"] == "point":
                        k = k if dd == 0 else k * 0.6 if dd == 1 else 0.0
                    else:
                        k *= 0.9
                    done = e >= dur
                elif r["kind"] == "hold":
                    base = 1.0 if dd == 0 else 0.6 if dd == 1 else 0.0
                    if r["end"] is None:
                        k = base
                    else:
                        k = base * max(0.0, 1 - (now - r["end"]) / 0.25)
                        done = now - r["end"] >= 0.25
                if k > 0:
                    cols[i] = mix(cols[i], r["color"], min(1.0, k))
            if not done:
                keep.append(r)
        self.reacts = keep
        return cols
