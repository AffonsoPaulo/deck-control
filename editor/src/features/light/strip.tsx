// A fita de LEDs desenhada num canvas (o drawStrip do editor atual) e um laço de animação só para todas as prévias
// visíveis. Cada prévia é um <StripCanvas> com o que mostrar (settings) e, se quiser, um tick por quadro (para
// disparar reações de exemplo).
import { useEffect, useRef } from "react";
import { cn } from "@/core/cn";
import { LED_N, LightSim, ringPoints, type Geo, type LightSettings, type Rgb } from "@/features/light/sim";

function roundRect(ctx: CanvasPath, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const glowCanvas = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

export function drawStrip(canvas: HTMLCanvasElement, cols: Rgb[], geo: Geo) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth,
    hgt = canvas.clientHeight;
  if (!w || !hgt) return;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  // o canvas pode ser maior que o aparelho (pad) para o brilho sumir aos poucos, sem corte reto
  const pad = geo.pad ?? 0;
  const sx = w / (geo.w + 2 * pad),
    sy = hgt / (geo.h + 2 * pad),
    ox = pad * sx,
    oy = pad * sy;
  const pts = ringPoints(geo.w, geo.h, geo.r, geo.inset).map(([x, y]) => [ox + x * sx, oy + y * sy] as [number, number]);
  const thick = geo.thick * sx,
    inset = geo.inset * sx,
    rad = (geo.r - geo.inset) * sx;
  const dw = geo.w * sx,
    dh = geo.h * sy;
  const step = (2 * (dw - 2 * inset + (dh - 2 * inset))) / LED_N;
  const css = (c: Rgb, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const o = inset - thick / 2,
    i2 = inset + thick / 2;
  const band = new Path2D();
  roundRect(band, ox + o, oy + o, dw - 2 * o, dh - 2 * o, rad + thick / 2);
  roundRect(band, ox + i2, oy + i2, dw - 2 * i2, dh - 2 * i2, Math.max(1, rad - thick / 2));
  const blobs = (c2: CanvasRenderingContext2D, radius: number, lit: boolean) =>
    cols.forEach((c, i) => {
      const [x, y] = pts[i] as [number, number];
      const a = lit ? Math.max(c[0], c[1], c[2]) / 255 : 1; // no brilho, LED apagado não conta
      if (a <= 0.02) return;
      const g = c2.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, css(c, a));
      g.addColorStop(0.5, css(c, 0.85 * a));
      g.addColorStop(1, css(c, 0));
      c2.fillStyle = g;
      c2.beginPath();
      c2.arc(x, y, radius, 0, Math.PI * 2);
      c2.fill();
    });
  const r = Math.max(step * 1.05, thick * 1.2);
  // brilho: a própria fita (só a parte acesa), desfocada por baixo. Acompanha a forma da fita e some aos poucos.
  if (geo.glow !== false) {
    let off = glowCanvas.get(canvas);
    if (!off) glowCanvas.set(canvas, (off = document.createElement("canvas")));
    if (off.width !== canvas.width || off.height !== canvas.height) {
      off.width = canvas.width;
      off.height = canvas.height;
    }
    const g2 = off.getContext("2d");
    if (g2) {
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      g2.clearRect(0, 0, w, hgt);
      g2.save();
      g2.clip(band, "evenodd");
      blobs(g2, r, true);
      g2.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.filter = `blur(${Math.round(thick * 1.5 * dpr)}px)`;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(off, 0, 0);
      ctx.filter = `blur(${Math.round(thick * 0.6 * dpr)}px)`;
      ctx.globalAlpha = 0.6;
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }
  }
  // a fita
  ctx.save();
  ctx.clip(band, "evenodd");
  ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--device-shell-2").trim() || "#1a1b1f";
  ctx.fillRect(0, 0, w, hgt);
  blobs(ctx, r, false);
  ctx.restore();
}

// ---------------------------------------------------------------------------- o laço

export interface StripView {
  sim: LightSim;
  geo: Geo;
  fps?: number | undefined;
  settings: () => LightSettings;
  brightness?: (() => number) | undefined;
  tick?: ((now: number, sim: LightSim) => void) | undefined;
}

interface Running {
  canvas: HTMLCanvasElement;
  view: () => StripView;
  at: number;
}

const VIEWS = new Set<Running>();
let raf = 0;
function loop() {
  raf = 0;
  const now = performance.now() / 1000;
  for (const v of VIEWS) {
    const view = v.view();
    if (view.fps && now - v.at < 1 / view.fps) continue;
    v.at = now;
    view.tick?.(now, view.sim);
    drawStrip(v.canvas, view.sim.frame(view.settings(), now, view.brightness?.()), view.geo);
  }
  if (VIEWS.size) raf = requestAnimationFrame(loop);
}

/** A fita animada. `view` pode mudar a cada render (lê sempre o último); o simulador vem de fora quando outra
 * peça precisa disparar reações nele (o palco da Luz). */
export function StripCanvas({ view, className }: { view: Omit<StripView, "sim"> & { sim?: LightSim | undefined }; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const own = useRef<LightSim | null>(null);
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const run: Running = {
      canvas,
      at: 0,
      view: () => {
        const v = latest.current;
        return { ...v, sim: v.sim ?? (own.current ??= new LightSim()) };
      },
    };
    VIEWS.add(run);
    if (!raf) raf = requestAnimationFrame(loop);
    return () => {
      VIEWS.delete(run);
    };
  }, []);
  return <canvas ref={ref} aria-hidden className={cn("absolute inset-0 size-full", className)} />;
}
