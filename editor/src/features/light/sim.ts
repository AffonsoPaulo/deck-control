// Prévia da luz do Deck: as mesmas contas de app/lighting.py (e do light.js do editor atual). O app manda as
// cores de verdade ao Deck; aqui só se desenha o que ele vai mostrar.
export type Rgb = [number, number, number];

export const LED_N = 18;
export const AMBER = "#F5A524";

export interface Reaction {
  kind?: string; // none | ripple | point | pulse | hold | default
  color?: string; // key | fixed | effect
  fixed?: string;
  speed?: number;
  reach?: number;
}

export interface LightSettings {
  effect: string;
  color: string;
  color2: string;
  speed: number;
  size: number;
  direction: string;
  brightness: number;
  per_page: boolean;
  off_with_screen: boolean;
  reaction: Reaction & { kind: string; color: string; fixed: string; speed: number; reach: number };
  pages?: Record<string, Partial<LightSettings>>;
}

export const LIGHT_DEFAULTS: LightSettings = {
  effect: "solid",
  color: AMBER,
  color2: "#E5701A",
  speed: 50,
  size: 50,
  direction: "cw",
  brightness: 80,
  per_page: false,
  off_with_screen: true,
  reaction: { kind: "ripple", color: "key", fixed: AMBER, speed: 50, reach: 100 },
};

export function hexRgb(hex: unknown): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(typeof hex === "string" ? hex : "");
  if (!m?.[1]) return [245, 165, 36];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mixc = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scalec = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
function hsvc(h: number): Rgb {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6),
    f = h * 6 - i,
    q = 1 - f;
  const six: Rgb[] = [
    [1, f, 0],
    [q, 1, 0],
    [0, 1, f],
    [0, q, 1],
    [f, 0, 1],
    [1, 0, q],
  ];
  const [r, g, b] = six[i % 6] as Rgb;
  return [r * 255, g * 255, b * 255];
}
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const AURORA_PAL = ["#14b8a6", "#22c55e", "#0ea5e9", "#6366f1"].map(hexRgb);
const CANDLE_PAL = ["#ff7a00", "#ffa000", "#ffc040"].map(hexRgb);
function palette(pal: Rgb[], t: number): Rgb {
  t = ((t % 1) + 1) % 1;
  const x = t * pal.length,
    i = Math.floor(x);
  return mixc(pal[i % pal.length] as Rgb, pal[(i + 1) % pal.length] as Rgb, x - i);
}
const ringDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % LED_N;
  return Math.min(d, LED_N - d);
};
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Live {
  led: number;
  kind: string | undefined;
  t0: number;
  color: Rgb;
  speed: number;
  reach: number;
  end: number | null;
}

export class LightSim {
  private star: [number, number][];
  private candle: [number, number][];
  private sparks: [number, number][] = [];
  private reacts: Live[] = [];
  private last: number | null = null;
  constructor() {
    const r = seeded(6);
    this.star = Array.from({ length: LED_N }, () => [1.8 + r() * 1.8, r() * 6.28]);
    this.candle = Array.from({ length: LED_N }, () => [r() * 6.28, 0.7 + r() * 0.6]);
  }
  effect(s: Pick<LightSettings, "effect" | "speed" | "size" | "direction" | "color" | "color2">, t: number, dt: number): Rgb[] {
    const N = LED_N,
      eff = s.effect;
    const sp = 0.3 + (Math.max(0, Math.min(100, s.speed)) / 100) * 1.7;
    const size = Math.max(0, Math.min(100, s.size)) / 100;
    const d = s.direction === "ccw" ? -1 : 1;
    const c1 = hexRgb(s.color),
      c2 = hexRgb(s.color2);
    const all = (c: Rgb) => Array.from({ length: N }, () => c);
    const each = (f: (i: number) => Rgb) => Array.from({ length: N }, (_, i) => f(i));
    switch (eff) {
      case "off":
        return all(BLACK);
      case "solid":
        return all(c1);
      case "breath":
        return all(scalec(c1, 0.12 + 0.88 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t * sp) / 3.2))));
      case "beat": {
        const ph = ((t * sp) / 1.6) % 1;
        const k = 0.12 + 0.88 * Math.max(Math.exp(-(((ph - 0.08) / 0.05) ** 2)), 0.85 * Math.exp(-(((ph - 0.28) / 0.06) ** 2)));
        return all(scalec(c1, k));
      }
      case "aurora":
        return each((i) => palette(AURORA_PAL, (t * sp) / 9 + (d * i) / N));
      case "candle":
        return each((i) => {
          const [ph, f] = this.candle[i] as [number, number];
          const n = 0.5 + 0.25 * Math.sin(t * 7.1 * f * sp + ph) + 0.25 * Math.sin(t * 12.7 * f * sp + 2 * ph);
          return scalec(palette(CANDLE_PAL, n * 0.66), 0.55 + 0.45 * n);
        });
      case "rainbow":
        return all(hsvc((t * sp) / 6));
      case "wave":
        return each((i) => hsvc((t * sp) / 4 - (d * i) / N));
      case "grad":
        return each((i) => mixc(c1, c2, 0.5 - 0.5 * Math.cos(2 * Math.PI * (i / N - (d * t * sp) / 6))));
      case "comet":
      case "chase": {
        const heads = eff === "comet" ? [((((t * sp) / 1.8) * N) % N)] : [(((t * sp) / 2.4) * N) % N, ((((t * sp) / 2.4) * N + N / 2) % N)];
        const trail = eff === "comet" ? 2 + size * 10 : 3;
        return each((i) => {
          const pos = d === 1 ? i : (N - i) % N;
          let k = 0;
          for (const hd of heads) k = Math.max(k, Math.max(0, 1 - ((((hd - pos) % N) + N) % N) / trail));
          let c = scalec(c1, k);
          if (k > 0.9) c = mixc(c, WHITE, (k - 0.9) * 4);
          return c;
        });
      }
      case "theater": {
        const step = Math.floor(t * sp * 3.3);
        return each((i) => (((((i * d - step) % 3) + 3) % 3) === 0 ? c1 : BLACK));
      }
      case "fill": {
        const ph = ((t * sp) / 4) % 1;
        return each((i) => {
          const pos = (d === 1 ? i : (N - i) % N) / N;
          return (ph < 0.5 ? pos < ph * 2 : pos >= (ph - 0.5) * 2) ? c1 : BLACK;
        });
      }
      case "stars": {
        const dens = 0.35 + size * 0.65;
        return each((i) => {
          const [per, ph] = this.star[i] as [number, number];
          let k = Math.max(0, Math.sin((2 * Math.PI * t * sp) / per + ph)) ** 3;
          if (((i * 7919) % 100) / 100 > dens) k = 0;
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
          out[led] = (out[led] as Rgb).map((v, j) => Math.max(v, c[j] as number)) as Rgb;
        }
        return out;
      }
      default:
        return all(c1);
    }
  }
  react(led: number, spec: Reaction, color: string, now: number) {
    this.reacts.push({ led, kind: spec.kind, t0: now, color: hexRgb(color), speed: spec.speed ?? 50, reach: spec.reach ?? 100, end: null });
    this.reacts = this.reacts.slice(-24);
  }
  release(now: number) {
    for (const r of this.reacts) if (r.kind === "hold" && r.end === null) r.end = now;
  }
  reactions(cols: Rgb[], now: number): Rgb[] {
    const keep: Live[] = [];
    for (const r of this.reacts) {
      const e = now - r.t0,
        v = 8 + (r.speed / 100) * 28,
        dur = 0.35 + (1 - r.speed / 100) * 0.6;
      const reach = Math.max(1, Math.round((r.reach / 100) * (LED_N / 2)));
      let done = false;
      for (let i = 0; i < LED_N; i++) {
        const dd = ringDist(i, r.led);
        let k = 0;
        if (r.kind === "ripple") {
          const x = e * v - dd;
          if (dd <= reach && x >= 0) k = Math.max(0, 1 - x / 3) * (1 - (0.4 * dd) / (reach + 1));
          done = e * v - reach > 3;
        } else if (r.kind === "point" || r.kind === "pulse") {
          k = Math.max(0, 1 - e / dur);
          k = r.kind === "point" ? (dd === 0 ? k : dd === 1 ? k * 0.6 : 0) : k * 0.9;
          done = e >= dur;
        } else if (r.kind === "hold") {
          const b = dd === 0 ? 1 : dd === 1 ? 0.6 : 0;
          if (r.end === null) k = b;
          else {
            k = b * Math.max(0, 1 - (now - r.end) / 0.25);
            done = now - r.end >= 0.25;
          }
        }
        if (k > 0) cols[i] = mixc(cols[i] as Rgb, r.color, Math.min(1, k));
      }
      if (!done) keep.push(r);
    }
    this.reacts = keep;
    return cols;
  }
  frame(s: LightSettings, now: number, brightness?: number): Rgb[] {
    const dt = this.last === null ? 0 : Math.max(0, Math.min(0.2, now - this.last));
    this.last = now;
    const cols = this.reactions(this.effect(s, now, dt), now);
    const k = (Math.max(0, Math.min(100, brightness ?? s.brightness)) / 100) ** 1.6;
    return cols.map((c) => c.map((v) => Math.max(0, Math.min(255, v * k))) as Rgb);
  }
}

// ---------------------------------------------------------------------------- geometria da fita

export interface Geo {
  w: number;
  h: number;
  r: number;
  inset: number;
  thick: number;
  pad?: number;
  glow?: boolean;
}
export const GEO_BIG: Geo = { w: 520, h: 330, r: 40, inset: 15, thick: 12, pad: 48 };
export const GEO_MINI: Geo = { w: 112, h: 40, r: 8, inset: 6, thick: 4 };
export const GEO_TILE: Geo = { w: 76, h: 36, r: 8, inset: 6, thick: 4 };

/** Onde fica cada um dos 18 LEDs na borda arredondada (começa embaixo, no meio, e vai no sentido horário). */
export function ringPoints(w: number, h: number, r: number, inset: number): [number, number][] {
  const x0 = inset,
    y0 = inset,
    x1 = w - inset,
    y1 = h - inset,
    rr = r - inset;
  const segs: [number, (t: number) => [number, number]][] = [];
  const line = (ax: number, ay: number, bx: number, by: number) =>
    segs.push([Math.hypot(bx - ax, by - ay), (t) => [ax + (bx - ax) * t, ay + (by - ay) * t]]);
  const arc = (cx: number, cy: number, a0: number, a1: number) =>
    segs.push([Math.abs(a1 - a0) * rr, (t) => [cx + rr * Math.cos(a0 + (a1 - a0) * t), cy + rr * Math.sin(a0 + (a1 - a0) * t)]]);
  const cx = (x0 + x1) / 2,
    P = Math.PI;
  line(cx, y1, x0 + rr, y1);
  arc(x0 + rr, y1 - rr, P / 2, P);
  line(x0, y1 - rr, x0, y0 + rr);
  arc(x0 + rr, y0 + rr, P, 1.5 * P);
  line(x0 + rr, y0, x1 - rr, y0);
  arc(x1 - rr, y0 + rr, 1.5 * P, 2 * P);
  line(x1, y0 + rr, x1, y1 - rr);
  arc(x1 - rr, y1 - rr, 0, P / 2);
  line(x1 - rr, y1, cx, y1);
  const total = segs.reduce((a, s) => a + s[0], 0);
  const pts: [number, number][] = [];
  for (let i = 0; i < LED_N; i++) {
    let dd = (total * i) / LED_N;
    for (let j = 0; j < segs.length; j++) {
      const [len, f] = segs[j] as [number, (t: number) => [number, number]];
      if (dd <= len || j === segs.length - 1) {
        pts.push(f(Math.min(1, len ? dd / len : 0)));
        break;
      }
      dd -= len;
    }
  }
  return pts;
}

/** Em que LED fica cada tecla (mesma conta do app). */
export const KEY_LED: Record<string, number> = (() => {
  const pts = ringPoints(520, 330, 40, 15),
    ks = 76,
    gap = 14;
  const gx = (520 - (5 * ks + 4 * gap)) / 2,
    gy = (330 - (3 * ks + 2 * gap)) / 2;
  const out: Record<string, number> = {};
  for (let k = 1; k <= 15; k++) {
    const row = Math.floor((k - 1) / 5),
      col = (k - 1) % 5;
    const x = gx + col * (ks + gap) + ks / 2,
      y = gy + row * (ks + gap) + ks / 2;
    let best = 0,
      bd = 1e9;
    pts.forEach(([px, py], i) => {
      const dd = Math.hypot(px - x, py - y);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    out[String(k)] = best;
  }
  return out;
})();
