"use strict";
// Luz do Deck no editor: a tela "Luz" (efeito do anel, reação padrão das teclas) e a aba "Luz" de cada tecla.
// A prévia é simulada aqui com as mesmas contas de app/lighting.py; o app manda as cores de verdade ao Deck.

const LED_N = 18;
const AMBER = "#F5A524";
const LIGHT_DEFAULTS = {
  effect: "solid", color: AMBER, color2: "#E5701A", speed: 50, size: 50, direction: "cw",
  brightness: 80, per_page: false, off_with_screen: true,
  reaction: { kind: "ripple", color: "key", fixed: AMBER, speed: 50, reach: 100 },
};
const EFFECT_KEYS = ["effect", "color", "color2", "speed", "size", "direction"];
// [efeito, nome, ajustes]  ajustes: c = cor, c2 = segunda cor, s = velocidade, z = tamanho, d = sentido
const LIGHT_GROUPS = [
  [t("Calm"), [["off", t("Off##2"), ""], ["solid", t("Solid color##2"), "c"], ["breath", t("Breathe"), "cs"], ["beat", t("Heartbeat"), "cs"],
    ["aurora", t("Aurora"), "sd"], ["candle", t("Candle"), "s"]]],
  [t("Colorful"), [["rainbow", t("Rainbow"), "s"], ["wave", t("Wave"), "sd"], ["grad", t("Gradient"), "c2sd"]]],
  [t("Motion"), [["comet", t("Comet"), "cszd"], ["chase", t("Chase"), "csd"], ["theater", t("Marquee"), "csd"], ["fill", t("Fill"), "csd"]]],
  [t("Sparkles"), [["stars", t("Stars"), "csz"], ["sparks", t("Sparks"), "csz"]]],
];
const EFFECT_INFO = Object.fromEntries(LIGHT_GROUPS.flatMap(([, items]) => items.map(([k, n, p]) => [k, { name: n, params: p }])));
const SIZE_LABEL = { comet: t("Trail"), stars: t("Amount"), sparks: t("Amount") };
const REACTION_NAMES = { none: t("None##2"), ripple: t("Wave"), point: t("Dot"), pulse: t("Pulse"), hold: t("Lit while held"), default: t("Default") };
const LIGHT_SWATCHES = [["#E5484D", t("Red")], ["#E5701A", t("Orange")], ["#F5A524", t("Amber")], ["#2F9E6A", t("Green")],
  ["#0F8F99", t("Teal")], ["#3E63DD", t("Blue")], ["#8E4EC6", t("Purple")], ["#FFFFFF", t("White")]];

// ---------------------------------------------------------------------------- config

const lightCfg = () => (isObj(S.cfg.lighting) ? S.cfg.lighting : null);
function lightSettings(page = S.page) {
  const raw = lightCfg() || {};
  const s = { ...LIGHT_DEFAULTS, ...raw, reaction: { ...LIGHT_DEFAULTS.reaction, ...(raw.reaction || {}) } };
  if (s.per_page) {
    const p = (raw.pages || {})[page] || {};
    for (const k of EFFECT_KEYS) if (k in p) s[k] = p[k];
  }
  return s;
}
function setLight(key, value) {           // efeito e ajustes: na página, se cada página tiver a sua
  const raw = lightCfg();
  if (!raw) return;
  if (raw.per_page && EFFECT_KEYS.includes(key)) {
    raw.pages = raw.pages || {};
    const p = (raw.pages[S.page] = raw.pages[S.page] || {});
    p[key] = value;
  } else raw[key] = value;
  changed({ keys: false });
}
function setReaction(key, value) {
  const raw = lightCfg();
  if (!raw) return;
  raw.reaction = { ...(raw.reaction || {}), [key]: value };
  changed({ keys: false });
}

// ---------------------------------------------------------------------------- simulador (igual a app/lighting.py)

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return [245, 165, 36];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scalec = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
function hsvc(h) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i, q = 1 - f;
  const [r, g, b] = [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][i % 6];
  return [r * 255, g * 255, b * 255];
}
const BLACK = [0, 0, 0], WHITE = [255, 255, 255];
const AURORA_PAL = ["#14b8a6", "#22c55e", "#0ea5e9", "#6366f1"].map(hexRgb);
const CANDLE_PAL = ["#ff7a00", "#ffa000", "#ffc040"].map(hexRgb);
function palette(pal, t) {
  t = ((t % 1) + 1) % 1;
  const x = t * pal.length, i = Math.floor(x);
  return mixc(pal[i % pal.length], pal[(i + 1) % pal.length], x - i);
}
const ringDist = (a, b) => { const d = Math.abs(a - b) % LED_N; return Math.min(d, LED_N - d); };
function seeded(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

class LightSim {
  constructor() {
    const r = seeded(6);
    this.star = Array.from({ length: LED_N }, () => [1.8 + r() * 1.8, r() * 6.28]);
    this.candle = Array.from({ length: LED_N }, () => [r() * 6.28, 0.7 + r() * 0.6]);
    this.sparks = []; this.reacts = []; this.last = null;
  }
  effect(s, t, dt) {
    const N = LED_N, eff = s.effect;
    const sp = 0.3 + Math.max(0, Math.min(100, s.speed)) / 100 * 1.7;
    const size = Math.max(0, Math.min(100, s.size)) / 100;
    const d = s.direction === "ccw" ? -1 : 1;
    const c1 = hexRgb(s.color), c2 = hexRgb(s.color2);
    const all = (c) => Array.from({ length: N }, () => c);
    const each = (f) => Array.from({ length: N }, (_, i) => f(i));
    switch (eff) {
      case "off": return all(BLACK);
      case "solid": return all(c1);
      case "breath": return all(scalec(c1, 0.12 + 0.88 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t * sp / 3.2))));
      case "beat": {
        const ph = ((t * sp / 1.6) % 1);
        const k = 0.12 + 0.88 * Math.max(Math.exp(-(((ph - 0.08) / 0.05) ** 2)), 0.85 * Math.exp(-(((ph - 0.28) / 0.06) ** 2)));
        return all(scalec(c1, k));
      }
      case "aurora": return each((i) => palette(AURORA_PAL, t * sp / 9 + d * i / N));
      case "candle": return each((i) => {
        const [ph, f] = this.candle[i];
        const n = 0.5 + 0.25 * Math.sin(t * 7.1 * f * sp + ph) + 0.25 * Math.sin(t * 12.7 * f * sp + 2 * ph);
        return scalec(palette(CANDLE_PAL, n * 0.66), 0.55 + 0.45 * n);
      });
      case "rainbow": return all(hsvc(t * sp / 6));
      case "wave": return each((i) => hsvc(t * sp / 4 - d * i / N));
      case "grad": return each((i) => mixc(c1, c2, 0.5 - 0.5 * Math.cos(2 * Math.PI * (i / N - d * t * sp / 6))));
      case "comet": case "chase": {
        const heads = eff === "comet" ? [(t * sp / 1.8 * N) % N] : [(t * sp / 2.4 * N) % N, (t * sp / 2.4 * N + N / 2) % N];
        const trail = eff === "comet" ? 2 + size * 10 : 3;
        return each((i) => {
          const pos = d === 1 ? i : (N - i) % N;
          let k = 0;
          for (const hd of heads) k = Math.max(k, Math.max(0, 1 - (((hd - pos) % N) + N) % N / trail));
          let c = scalec(c1, k);
          if (k > 0.9) c = mixc(c, WHITE, (k - 0.9) * 4);
          return c;
        });
      }
      case "theater": { const step = Math.floor(t * sp * 3.3); return each((i) => ((((i * d) - step) % 3) + 3) % 3 === 0 ? c1 : BLACK); }
      case "fill": {
        const ph = (t * sp / 4) % 1;
        return each((i) => { const pos = (d === 1 ? i : (N - i) % N) / N; return (ph < 0.5 ? pos < ph * 2 : pos >= (ph - 0.5) * 2) ? c1 : BLACK; });
      }
      case "stars": {
        const dens = 0.35 + size * 0.65;
        return each((i) => {
          const [per, ph] = this.star[i];
          let k = Math.max(0, Math.sin(2 * Math.PI * t * sp / per + ph)) ** 3;
          if ((i * 7919 % 100) / 100 > dens) k = 0;
          return scalec(mixc(hexRgb("#f5f0dc"), c1, 0.35), k);
        });
      }
      case "sparks": {
        const rate = (2 + size * 12) * sp;
        if (dt > 0 && Math.random() < rate * dt) this.sparks.push([Math.floor(Math.random() * N), t]);
        this.sparks = this.sparks.filter((x) => t - x[1] < 0.6);
        const out = all(BLACK);
        for (const [led, t0] of this.sparks) {
          const k = Math.max(0, 1 - (t - t0) / 0.6);
          const c = mixc(scalec(c1, k), WHITE, k * 0.5);
          out[led] = out[led].map((v, j) => Math.max(v, c[j]));
        }
        return out;
      }
      default: return all(c1);
    }
  }
  react(led, spec, color, now) {
    this.reacts.push({ led, kind: spec.kind, t0: now, color: hexRgb(color), speed: spec.speed ?? 50, reach: spec.reach ?? 100, end: null });
    this.reacts = this.reacts.slice(-24);
  }
  release(now) { for (const r of this.reacts) if (r.kind === "hold" && r.end === null) r.end = now; }
  reactions(cols, now) {
    const keep = [];
    for (const r of this.reacts) {
      const e = now - r.t0, v = 8 + r.speed / 100 * 28, dur = 0.35 + (1 - r.speed / 100) * 0.6;
      const reach = Math.max(1, Math.round(r.reach / 100 * (LED_N / 2)));
      let done = false;
      for (let i = 0; i < LED_N; i++) {
        const dd = ringDist(i, r.led);
        let k = 0;
        if (r.kind === "ripple") {
          const x = e * v - dd;
          if (dd <= reach && x >= 0) k = Math.max(0, 1 - x / 3) * (1 - 0.4 * dd / (reach + 1));
          done = e * v - reach > 3;
        } else if (r.kind === "point" || r.kind === "pulse") {
          k = Math.max(0, 1 - e / dur);
          k = r.kind === "point" ? (dd === 0 ? k : dd === 1 ? k * 0.6 : 0) : k * 0.9;
          done = e >= dur;
        } else if (r.kind === "hold") {
          const b = dd === 0 ? 1 : dd === 1 ? 0.6 : 0;
          if (r.end === null) k = b; else { k = b * Math.max(0, 1 - (now - r.end) / 0.25); done = now - r.end >= 0.25; }
        }
        if (k > 0) cols[i] = mixc(cols[i], r.color, Math.min(1, k));
      }
      if (!done) keep.push(r);
    }
    this.reacts = keep;
    return cols;
  }
  frame(s, now, brightness) {
    const dt = this.last === null ? 0 : Math.max(0, Math.min(0.2, now - this.last));
    this.last = now;
    const cols = this.reactions(this.effect(s, now, dt), now);
    const k = (Math.max(0, Math.min(100, brightness ?? s.brightness)) / 100) ** 1.6;
    return cols.map((c) => c.map((v) => Math.max(0, Math.min(255, v * k))));
  }
}

// ---------------------------------------------------------------------------- geometria e desenho da fita

function ringPoints(w, h, r, inset) {
  const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset, rr = r - inset;
  const segs = [];
  const line = (ax, ay, bx, by) => segs.push([Math.hypot(bx - ax, by - ay), (t) => [ax + (bx - ax) * t, ay + (by - ay) * t]]);
  const arc = (cx, cy, a0, a1) => segs.push([Math.abs(a1 - a0) * rr, (t) => [cx + rr * Math.cos(a0 + (a1 - a0) * t), cy + rr * Math.sin(a0 + (a1 - a0) * t)]]);
  const cx = (x0 + x1) / 2, P = Math.PI;
  line(cx, y1, x0 + rr, y1); arc(x0 + rr, y1 - rr, P / 2, P); line(x0, y1 - rr, x0, y0 + rr); arc(x0 + rr, y0 + rr, P, 1.5 * P);
  line(x0 + rr, y0, x1 - rr, y0); arc(x1 - rr, y0 + rr, 1.5 * P, 2 * P); line(x1, y0 + rr, x1, y1 - rr); arc(x1 - rr, y1 - rr, 0, P / 2);
  line(x1 - rr, y1, cx, y1);
  const total = segs.reduce((a, s) => a + s[0], 0);
  const pts = [];
  for (let i = 0; i < LED_N; i++) {
    let dd = total * i / LED_N;
    for (let j = 0; j < segs.length; j++) {
      const [len, f] = segs[j];
      if (dd <= len || j === segs.length - 1) { pts.push(f(Math.min(1, len ? dd / len : 0))); break; }
      dd -= len;
    }
  }
  return pts;
}
// em que LED fica cada tecla (mesma conta do app)
const KEY_LED = (() => {
  const pts = ringPoints(520, 330, 40, 15), ks = 76, gap = 14;
  const gx = (520 - (5 * ks + 4 * gap)) / 2, gy = (330 - (3 * ks + 2 * gap)) / 2;
  const out = {};
  for (let k = 1; k <= 15; k++) {
    const row = Math.floor((k - 1) / 5), col = (k - 1) % 5;
    const x = gx + col * (ks + gap) + ks / 2, y = gy + row * (ks + gap) + ks / 2;
    let best = 0, bd = 1e9;
    pts.forEach(([px, py], i) => { const dd = Math.hypot(px - x, py - y); if (dd < bd) { bd = dd; best = i; } });
    out[k] = best;
  }
  return out;
})();

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawStrip(canvas, cols, geo) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  if (!w || !hgt) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  // o canvas pode ser maior que o aparelho (pad) para o brilho sumir aos poucos, sem corte reto
  const pad = geo.pad || 0;
  const sx = w / (geo.w + 2 * pad), sy = hgt / (geo.h + 2 * pad), ox = pad * sx, oy = pad * sy;
  const pts = ringPoints(geo.w, geo.h, geo.r, geo.inset).map(([x, y]) => [ox + x * sx, oy + y * sy]);
  const thick = geo.thick * sx, inset = geo.inset * sx, rad = (geo.r - geo.inset) * sx;
  const dw = geo.w * sx, dh = geo.h * sy;
  const step = 2 * ((dw - 2 * inset) + (dh - 2 * inset)) / LED_N;
  const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const o = inset - thick / 2, i2 = inset + thick / 2;
  const band = new Path2D();
  roundRect(band, ox + o, oy + o, dw - 2 * o, dh - 2 * o, rad + thick / 2);
  roundRect(band, ox + i2, oy + i2, dw - 2 * i2, dh - 2 * i2, Math.max(1, rad - thick / 2));
  const blobs = (c2, radius, lit) => cols.forEach((c, i) => {
    const [x, y] = pts[i];
    const a = lit ? Math.max(c[0], c[1], c[2]) / 255 : 1;      // no brilho, LED apagado não conta
    if (a <= 0.02) return;
    const g = c2.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, css(c, a)); g.addColorStop(0.5, css(c, 0.85 * a)); g.addColorStop(1, css(c, 0));
    c2.fillStyle = g; c2.beginPath(); c2.arc(x, y, radius, 0, Math.PI * 2); c2.fill();
  });
  const r = Math.max(step * 1.05, thick * 1.2);
  // brilho: a própria fita (só a parte acesa), desfocada por baixo. Acompanha a forma da fita e some aos poucos.
  if (geo.glow !== false) {
    const off = canvas._glow || (canvas._glow = document.createElement("canvas"));
    if (off.width !== canvas.width || off.height !== canvas.height) { off.width = canvas.width; off.height = canvas.height; }
    const g2 = off.getContext("2d");
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, w, hgt);
    g2.save(); g2.clip(band, "evenodd"); blobs(g2, r, true); g2.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.filter = `blur(${Math.round(thick * 1.5 * dpr)}px)`;
    ctx.globalAlpha = 0.9; ctx.drawImage(off, 0, 0);
    ctx.filter = `blur(${Math.round(thick * 0.6 * dpr)}px)`;
    ctx.globalAlpha = 0.6; ctx.drawImage(off, 0, 0);
    ctx.restore();
  }
  // a fita
  ctx.save(); ctx.clip(band, "evenodd");
  ctx.fillStyle = "#1b1d22"; ctx.fillRect(0, 0, w, hgt);
  blobs(ctx, r, false);
  ctx.restore();
}

// animação: um laço só para todas as prévias visíveis
const LIGHT_VIEWS = new Set();
let lightRaf = 0;
function lightLoop() {
  lightRaf = 0;
  const now = performance.now() / 1000;
  for (const v of [...LIGHT_VIEWS]) {
    if (!v.canvas.isConnected) { LIGHT_VIEWS.delete(v); continue; }
    if (v.fps && now - (v.at || 0) < 1 / v.fps) continue;
    v.at = now;
    if (v.tick) v.tick(now);
    drawStrip(v.canvas, v.sim.frame(v.settings(), now, v.brightness ? v.brightness() : undefined), v.geo);
  }
  if (LIGHT_VIEWS.size) lightRaf = requestAnimationFrame(lightLoop);
}
function watchStrip(view) {
  view.sim = view.sim || new LightSim();
  LIGHT_VIEWS.add(view);
  if (!lightRaf) lightRaf = requestAnimationFrame(lightLoop);
  return view;
}
const GEO_BIG = { w: 520, h: 330, r: 40, inset: 15, thick: 12, pad: 48 };
const GEO_MINI = { w: 112, h: 40, r: 8, inset: 6, thick: 4 };
const GEO_TILE = { w: 76, h: 36, r: 8, inset: 6, thick: 4 };

// ---------------------------------------------------------------------------- partes comuns

function seg(options, value, onPick, cls = "") {
  return h("div", { class: "segmented " + cls, role: "group" },
    ...options.map(([v, l, icon]) => h("button", { "aria-pressed": value === v ? "true" : "false", onclick: () => onPick(v) },
      icon ? ic(icon) : null, l)));
}
function slider(label, value, onInput, fmt, min = 0, max = 100) {
  const out = h("span", { class: "rv" }, fmt(value));
  return h("div", { class: "rrow" }, h("span", { class: "clabel" }, label),
    h("input", { type: "range", min, max, value, "aria-label": label,
      oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); onInput(v); } }), out);
}
const speedName = (v) => (v < 25 ? t("Slow") : v < 60 ? t("Medium") : v < 85 ? t("Fast") : t("Very fast"));
const sizeName = (v) => (v < 34 ? t("Short") : v < 67 ? t("Medium##2") : t("Long"));
const qtyName = (v) => (v < 34 ? t("Few") : v < 67 ? t("Medium##2") : t("Many"));
const reachName = (v) => (v >= 100 ? t("All") : `${Math.round(v)}%`);

function keyBg(page, key) {
  const spec = pageKeys(page)[key];
  const bg = spec && normalizeIcon(spec.icon).bg;
  return /^#[0-9a-f]{6}$/i.test(bg || "") ? bg : null;
}
function reactionColor(spec, key, settings) {
  const mode = spec.color || settings.reaction.color || "key";
  if (mode === "fixed") return spec.fixed || settings.reaction.fixed || AMBER;
  if (mode === "effect") return ["rainbow", "wave", "aurora", "candle", "off"].includes(settings.effect) ? "#FFFFFF" : settings.color;
  const c = keyBg(S.page, key);
  if (!c) return AMBER;
  const [r, g, b] = hexRgb(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 40 ? AMBER : c;
}

// mini prévia de uma reação: o efeito apagado e a reação saindo do canto de baixo à direita a cada 2,4 s
function reactionTile(kind, name, pressed, onPick, color = AMBER) {
  const canvas = h("canvas", { class: "strip-canvas", "aria-hidden": "true" });
  const off = { ...LIGHT_DEFAULTS, effect: "off" };
  let next = 0;
  if (kind !== "none" && kind !== "default") watchStrip({ canvas, geo: GEO_TILE, fps: 30, settings: () => off, brightness: () => 100,
    tick(now) {
      if (now >= next) {
        if (kind === "hold") { this.sim.release(now); }
        this.sim.react(16, { kind, speed: 55, reach: 100 }, color, now);
        if (kind === "hold") setTimeout(() => this.sim.release(performance.now() / 1000), 1300);
        next = now + 2.4;
      }
    } });
  else if (kind === "default") watchStrip({ canvas, geo: GEO_TILE, fps: 30, settings: () => off, brightness: () => 100,
    tick(now) { if (now >= next) { const st = lightSettings(); const r = st.reaction; if (r.kind !== "none") this.sim.react(16, r, color, now); next = now + 2.4; } } });
  else watchStrip({ canvas, geo: GEO_TILE, fps: 4, settings: () => off, brightness: () => 100 });
  return h("button", { class: "fx-card tile", "aria-pressed": pressed ? "true" : "false", onclick: onPick }, h("span", { class: "fx-prev" }, canvas), name);
}

// ---------------------------------------------------------------------------- tela "Luz"

function renderLightView() {
  const el = $("#lightView");
  const keep = el.scrollTop;
  el.replaceChildren();
  requestAnimationFrame(() => { el.scrollTop = keep; });
  const raw = lightCfg();
  const st = lightSettings();
  const on = !!raw;
  const ro = on ? {} : { inert: "" };
  const rerender = () => renderLightView();

  // palco: o Deck com as teclas da página e a fita em volta; clicar numa tecla mostra a reação dela
  const canvas = h("canvas", { class: "strip-canvas", "aria-hidden": "true" });
  const sim = new LightSim();
  watchStrip({ canvas, sim, geo: GEO_BIG, settings: () => (lightCfg() ? lightSettings() : { ...LIGHT_DEFAULTS, effect: "off" }) });
  const keys = h("div", { class: "lv-keys" });
  const pv = S.previews[S.page] || [];
  for (const k of KEYS) {
    const spec = pageKeys()[k];
    const img = pv[Number(k) - 1];
    const btn = h("button", { class: "lv-key" + (spec ? "" : " empty"), "aria-label": t("Key {0}: see the reaction", [k]), title: t("Click to see this key's reaction"),
      onpointerdown: () => {
        if (!lightCfg()) return;
        const now = performance.now() / 1000, s = lightSettings();
        const light = (spec && spec.light) || {};
        const r = light.press && light.press.kind && light.press.kind !== "default" ? light.press : s.reaction;
        if (r.kind && r.kind !== "none") sim.react(KEY_LED[k], r, reactionColor(r, k, s), now);
      } }, img ? h("img", { src: img.normal, alt: "" }) : null);
    keys.append(btn);
  }
  if (!pv.length) updatePreviews().then(() => { if (S.section === "light") renderLightView(); });
  const stage = h("section", { class: "lv-stage" },
    h("div", { class: "lv-device" }, canvas, h("div", { class: "lv-body" }, keys)),
    h("p", { class: "lv-note" }, on ? t("Click a key to see its reaction.") : t("The Deck light isn't controlled by the app yet. Turn it on in General.")));

  // efeitos
  const effCard = h("section", { class: "lv-card", ...ro },
    h("div", { class: "lv-head" }, h("h2", {}, t("Effect")), h("span", { class: "grow" }),
      st.per_page
        ? h("select", { class: "inl", "aria-label": t("Light page"), title: t("Which page this light is for"),
            onchange: (e) => { S.page = e.target.value; S.key = null; renderAll(); } },
            ...Object.keys(pages()).map((p) => h("option", { value: p, selected: p === S.page }, t("Page {0}", [p]))))
        : h("span", { class: "msub" }, t("{0} effects", [15]))));
  for (const [gname, items] of LIGHT_GROUPS) {
    const grid = h("div", { class: "fx-grid" });
    for (const [k, name] of items) {
      const c = h("canvas", { class: "strip-canvas", "aria-hidden": "true" });
      watchStrip({ canvas: c, geo: GEO_MINI, fps: 24, settings: () => ({ ...lightSettings(), effect: k }), brightness: () => 100 });
      grid.append(h("button", { class: "fx-card", "aria-pressed": st.effect === k ? "true" : "false",
        onclick: () => { setLight("effect", k); rerender(); } }, h("span", { class: "fx-prev" }, c), name));
    }
    effCard.append(h("div", { class: "fx-group" }, h("span", { class: "fx-label" }, gname), grid));
  }

  // geral
  const general = h("section", { class: "lv-card" },
    h("div", { class: "lv-head" }, h("h2", {}, t("General"))),
    toggleRow(t("Control the Deck light"), on, (v) => {
      if (v) S.cfg.lighting = clone(lightCfg()) || { effect: "solid", color: AMBER, brightness: 80, reaction: { kind: "ripple", color: "key" } };
      else delete S.cfg.lighting;
      changed({ keys: false }); rerender();
    }),
    h("div", { class: "lv-stack", ...ro },
      slider(t("Brightness"), st.brightness, (v) => setLight("brightness", v), (v) => `${v}%`),
      toggleRow(t("Each page with its own light"), !!st.per_page, (v) => { setLight("per_page", v); rerender(); }),
      toggleRow(t("Turn off with the PC screen"), st.off_with_screen !== false, (v) => { setLight("off_with_screen", v); rerender(); })),
    h("p", { class: "hint" }, t("Two quick clicks on the Deck back button hand the light over to the app. A single click switches to the device's own effects.")));

  // ajustes do efeito
  const info = EFFECT_INFO[st.effect] || EFFECT_INFO.solid;
  const adj = h("section", { class: "lv-card", ...ro }, h("div", { class: "lv-head" }, h("h2", {}, t("Settings##2")), h("span", { class: "msub" }, info.name)));
  const p = info.params;
  if (p.includes("c")) adj.append(colorRow(p.includes("2") ? t("Color 1") : t("Color"), swatchRow(st.color, (v) => setLight("color", v || AMBER), false, LIGHT_SWATCHES)));
  if (p.includes("2")) adj.append(colorRow(t("Color 2"), swatchRow(st.color2, (v) => setLight("color2", v || "#E5701A"), false, LIGHT_SWATCHES)));
  if (p.includes("s")) adj.append(slider(t("Speed"), st.speed, (v) => setLight("speed", v), speedName));
  if (p.includes("z")) adj.append(slider(SIZE_LABEL[st.effect] || t("Size"), st.size, (v) => setLight("size", v), st.effect === "comet" ? sizeName : qtyName));
  if (p.includes("d")) adj.append(h("div", { class: "rrow" }, h("span", { class: "clabel" }, t("Direction")),
    seg([["cw", t("Clockwise"), "rotate-cw"], ["ccw", t("Counterclockwise"), "rotate-ccw"]], st.direction, (v) => { setLight("direction", v); rerender(); }, "small")));
  if (!p) adj.append(h("p", { class: "hint" }, t("With the light off, there's nothing to adjust. Key reactions keep working.")));

  // reação padrão
  const r = st.reaction;
  const react = h("section", { class: "lv-card", ...ro }, h("div", { class: "lv-head" }, h("h2", {}, t("Default key reaction"))),
    h("div", { class: "tile-grid" }, ...["none", "ripple", "point", "pulse"].map((k) =>
      reactionTile(k, REACTION_NAMES[k], r.kind === k, () => { setReaction("kind", k); rerender(); }))));
  if (r.kind !== "none") {
    react.append(h("div", { class: "rrow" }, h("span", { class: "clabel" }, t("Color")),
      seg([["key", t("From the key")], ["fixed", t("Fixed")], ["effect", t("From the effect")]], r.color || "key", (v) => { setReaction("color", v); rerender(); }, "small")));
    if (r.color === "fixed") react.append(colorRow("", swatchRow(r.fixed || AMBER, (v) => setReaction("fixed", v || AMBER), false, LIGHT_SWATCHES)));
    react.append(slider(t("Speed"), r.speed ?? 50, (v) => setReaction("speed", v), speedName));
    if (r.kind === "ripple") react.append(slider(t("Reach"), r.reach ?? 100, (v) => setReaction("reach", v), reachName, 10, 100));
  }
  react.append(h("p", { class: "hint" }, t("Applies to every key on press. A key with its own reaction, in its Light tab, uses its own.")));

  el.append(stage, effCard, general, adj, react);
}

// ---------------------------------------------------------------------------- aba "Luz" da tecla

const LIGHT_MOMENTS = [["press", t("On press")], ["hold", t("On hold")], ["release", t("On release")]];
function momentSummary(r, moment) {
  if (!r || !r.kind || r.kind === "default") return t("Default");
  if (r.kind === "none" || r.kind === "hold") return REACTION_NAMES[r.kind];
  const color = r.color === "fixed" ? t("fixed color") : r.color === "effect" ? t("effect color") : t("key color");
  return `${REACTION_NAMES[r.kind]}, ${color}`;
}
function lightTab(spec) {
  const body = h("div", { class: "insp-body light-tab" });
  const moment = S.lightMoment || "press";
  const light = isObj(spec.light) ? spec.light : {};
  const cur = light[moment] || {};
  const kind = cur.kind || "default";
  const st = lightSettings();
  const save = (r) => {
    const l = isObj(spec.light) ? { ...spec.light } : {};
    if (!r || r.kind === "default") delete l[moment]; else l[moment] = r;
    if (Object.keys(l).length) spec.light = l; else delete spec.light;
    changed({ keys: false }); renderInspector();
  };
  const set = (k, v) => save({ kind, ...cur, [k]: v });

  if (!lightCfg()) body.append(h("div", { class: "note-box" }, ic("info"),
    h("span", {}, t("The app doesn't control the Deck light yet. Turn it on in Light, in the left menu, for reactions to work.")),
    h("button", { class: "btn small", onclick: () => { S.section = "light"; renderAll(); } }, t("Open Light"))));

  body.append(h("div", { class: "lfield" }, h("span", { class: "msub" }, t("Each moment has its own reaction")),
    h("div", { class: "segmented full moments" }, ...LIGHT_MOMENTS.map(([m, l]) =>
      h("button", { "aria-pressed": moment === m ? "true" : "false", onclick: () => { S.lightMoment = m; renderInspector(); } },
        h("span", {}, l), h("small", {}, momentSummary(light[m], m)))))));

  const kinds = ["default", "ripple", "point", "pulse"].concat(moment === "hold" ? ["hold"] : []);
  const color = reactionColor(cur.kind && cur.kind !== "default" ? cur : st.reaction, S.key, st);
  const label = LIGHT_MOMENTS.find(([m]) => m === moment)[1].toLowerCase();
  const sec = h("section", { class: "lsec" }, sectionHead(t("Reaction {0}", [label])),
    h("div", { class: "tile-grid" + (kinds.length > 4 ? " five" : "") }, ...kinds.map((k) =>
      reactionTile(k, REACTION_NAMES[k], kind === k, () => save(k === "default" ? null : { ...cur, kind: k }), color))),
    h("p", { class: "hint" }, moment === "press"
      ? t("Chosen here, it replaces the default reaction from the light panel. In Default, this key follows the panel (now: {0}).", [REACTION_NAMES[st.reaction.kind].toLowerCase()])
      : t("In Default, nothing happens in this moment: the default reaction only applies on press.")));
  body.append(sec);

  if (["ripple", "point", "pulse"].includes(kind) || kind === "hold") {
    const names = { ripple: t("wave"), point: t("dot"), pulse: t("pulse"), hold: t("lit light") };
    const adj = h("section", { class: "lsec" }, sectionHead(t("Settings for the {0}", [names[kind]])),
      h("div", { class: "rrow" }, h("span", { class: "clabel" }, t("Color")),
        seg([["key", t("From the key")], ["fixed", t("Fixed")], ["effect", t("From the effect")]], cur.color || "key", (v) => set("color", v), "small")));
    if (cur.color === "fixed") adj.append(colorRow("", swatchRow(cur.fixed || AMBER, (v) => set("fixed", v || AMBER), false, LIGHT_SWATCHES)));
    if (kind !== "hold") adj.append(slider(t("Speed"), cur.speed ?? 50, (v) => { cur.speed = v; spec.light[moment] = { kind, ...cur }; changed({ keys: false }); }, speedName));
    if (kind === "ripple") adj.append(slider(t("Reach"), cur.reach ?? 100, (v) => { cur.reach = v; spec.light[moment] = { kind, ...cur }; changed({ keys: false }); }, reachName, 10, 100));
    body.append(adj);
  }
  body.append(h("p", { class: "hint" }, t("Each moment keeps its own reaction and settings. On hold also offers “Lit while held”: the LEDs near the key stay lit until you let go.")));
  return body;
}
