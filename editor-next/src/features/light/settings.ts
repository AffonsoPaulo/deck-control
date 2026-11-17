// A luz no config (lighting): os ajustes com os padrões, a gravação (o efeito vai para a página quando cada página
// tem a sua), a cor de cada reação e os nomes que aparecem na tela. Mesmas regras do light.js do editor atual.
import { isObj, normalizeIcon, type Obj } from "@/core/obj";
import { useConfig, type Config } from "@/core/store/config";
import { pageKeysOf } from "@/features/keys/model";
import { AMBER, LIGHT_DEFAULTS, hexRgb, type LightSettings, type Reaction } from "@/features/light/sim";

type T = (s: string, a?: unknown[]) => string;

export const EFFECT_KEYS = ["effect", "color", "color2", "speed", "size", "direction"] as const;

/** [efeito, nome, ajustes]; ajustes: c = cor, 2 = segunda cor, s = velocidade, z = tamanho, d = sentido */
export function lightGroups(t: T): [string, [string, string, string][]][] {
  return [
    [
      t("Calm"),
      [
        ["off", t("Off##2"), ""],
        ["solid", t("Solid color##2"), "c"],
        ["breath", t("Breathe"), "cs"],
        ["beat", t("Heartbeat"), "cs"],
        ["aurora", t("Aurora"), "sd"],
        ["candle", t("Candle"), "s"],
      ],
    ],
    [
      t("Colorful"),
      [
        ["rainbow", t("Rainbow"), "s"],
        ["wave", t("Wave"), "sd"],
        ["grad", t("Gradient"), "c2sd"],
      ],
    ],
    [
      t("Motion"),
      [
        ["comet", t("Comet"), "cszd"],
        ["chase", t("Chase"), "csd"],
        ["theater", t("Marquee"), "csd"],
        ["fill", t("Fill"), "csd"],
      ],
    ],
    [
      t("Sparkles"),
      [
        ["stars", t("Stars"), "csz"],
        ["sparks", t("Sparks"), "csz"],
      ],
    ],
  ];
}

export function effectInfo(t: T): Record<string, { name: string; params: string }> {
  return Object.fromEntries(lightGroups(t).flatMap(([, items]) => items.map(([k, n, p]) => [k, { name: n, params: p }])));
}

export const reactionNames = (t: T): Record<string, string> => ({
  none: t("None##2"),
  ripple: t("Wave"),
  point: t("Dot"),
  pulse: t("Pulse"),
  hold: t("Lit while held"),
  default: t("Default"),
});

export const lightSwatches = (t: T) =>
  (
    [
      ["#E5484D", t("Red")],
      ["#E5701A", t("Orange")],
      ["#F5A524", t("Amber")],
      ["#2F9E6A", t("Green")],
      ["#0F8F99", t("Teal")],
      ["#3E63DD", t("Blue")],
      ["#8E4EC6", t("Purple")],
      ["#FFFFFF", t("White")],
    ] as const
  ).map(([value, label]) => ({ value, label }));

export const speedName = (t: T) => (v: number) => (v < 25 ? t("Slow") : v < 60 ? t("Medium") : v < 85 ? t("Fast") : t("Very fast"));
export const sizeName = (t: T) => (v: number) => (v < 34 ? t("Short") : v < 67 ? t("Medium##2") : t("Long"));
export const qtyName = (t: T) => (v: number) => (v < 34 ? t("Few") : v < 67 ? t("Medium##2") : t("Many"));
export const reachName = (t: T) => (v: number) => (v >= 100 ? t("All") : `${Math.round(v)}%`);

export const lightCfg = (cfg: Config | null | undefined): Obj | null => (cfg && isObj(cfg.lighting) ? cfg.lighting : null);

export function lightSettings(cfg: Config | null | undefined, page: string | null): LightSettings {
  const raw = lightCfg(cfg) ?? {};
  const s = { ...LIGHT_DEFAULTS, ...raw, reaction: { ...LIGHT_DEFAULTS.reaction, ...(isObj(raw.reaction) ? raw.reaction : {}) } } as LightSettings;
  if (s.per_page && page !== null) {
    const pages = isObj(raw.pages) ? raw.pages : {};
    const p = isObj(pages[page]) ? (pages[page] as Obj) : {};
    for (const k of EFFECT_KEYS) if (k in p) (s as unknown as Obj)[k] = p[k];
  }
  return s;
}

/** Efeito e ajustes: na página, se cada página tiver a sua. Sem a luz ligada no app, não grava nada. */
export function setLight(page: string | null, key: string, value: unknown, tag?: string) {
  useConfig.getState().edit((d) => {
    const raw = lightCfg(d);
    if (!raw) return;
    if (raw.per_page && page !== null && (EFFECT_KEYS as readonly string[]).includes(key)) {
      if (!isObj(raw.pages)) raw.pages = {};
      const pages = raw.pages as Obj;
      if (!isObj(pages[page])) pages[page] = {};
      (pages[page] as Obj)[key] = value;
    } else raw[key] = value;
  }, tag);
}

export function setReaction(key: string, value: unknown, tag?: string) {
  useConfig.getState().edit((d) => {
    const raw = lightCfg(d);
    if (!raw) return;
    raw.reaction = { ...(isObj(raw.reaction) ? raw.reaction : {}), [key]: value };
  }, tag);
}

function keyBg(cfg: Config | null | undefined, page: string | null, key: string): string | null {
  if (page === null) return null;
  const spec = pageKeysOf(cfg ?? null, page)[key];
  const bg = spec ? normalizeIcon(spec.icon).bg : null;
  return typeof bg === "string" && /^#[0-9a-f]{6}$/i.test(bg) ? bg : null;
}

/** A cor que a reação acende: da tecla (o fundo dela; escuro demais vira âmbar), fixa ou do efeito. */
export function reactionColor(spec: Reaction, key: string | null, s: LightSettings, cfg: Config | null | undefined, page: string | null): string {
  const mode = spec.color || s.reaction.color || "key";
  if (mode === "fixed") return spec.fixed || s.reaction.fixed || AMBER;
  if (mode === "effect") return ["rainbow", "wave", "aurora", "candle", "off"].includes(s.effect) ? "#FFFFFF" : s.color;
  const c = key === null ? null : keyBg(cfg, page, key);
  if (!c) return AMBER;
  const [r, g, b] = hexRgb(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 40 ? AMBER : c;
}
