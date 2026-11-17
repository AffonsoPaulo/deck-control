// Ações e peças como dados (sem React): as categorias e as cores, o nome e o ícone automáticos de uma ação, o
// passo novo de cada tipo, pôr uma ação numa tecla, e colocar um widget ou uma tecla guardada (o que sai do lugar).
// Mesmas regras do editor atual (app.js: GROUPS/applySchema/autoText/autoIcon/autoActive/newStep/assignAction;
// info.js: clearKeys/placeSaved/pieceOver; widgets.js: widgetDefs/placeWidget).
import type { EditorSchema } from "@/core/api-types";
import type { Config } from "@/core/store/config";
import { coverMap, footprint, pagesOf, sizeRC, spanOf, type KeySpec, type PageKeys } from "@/features/keys/model";
import { clone, isObj, normalizeIcon, type Obj } from "@/core/obj";

type T = (s: string, args?: unknown[]) => string;

export interface ActionField {
  name: string;
  label?: string;
  kind?: string;
  required?: boolean;
  options?: [unknown, string][];
}
export interface ActionDef {
  label: string;
  help?: string;
  group?: string;
  icon?: string;
  short?: string;
  fields?: ActionField[];
}

export const actionDefs = (schema: EditorSchema | undefined): Record<string, ActionDef> =>
  (schema?.actions ?? {}) as unknown as Record<string, ActionDef>;

// ---------------------------------------------------------------------------- categorias

export interface Group {
  name: string; // "Keyboard and text" (o texto do t())
  color: string; // a base da categoria: "var(--cat-blue)"
  bg: string; // fundo da tecla nova dessa categoria (#rrggbb)
}

const cssVar = (name: string): string =>
  typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** #rrggbb mais escuro (o darker do editor atual); o que não é #rrggbb vira preto. */
export function darker(hex: unknown, f = 0.45): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(typeof hex === "string" ? hex : "");
  if (!m?.[1]) return "#000000";
  const n = parseInt(m[1], 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - f)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** As categorias, na ordem; as dos plugins entram antes de "Other". */
export function groupsOf(schema: EditorSchema | undefined, read: (name: string) => string = cssVar): Group[] {
  const base: Group[] = [
    { name: "Keyboard and text", color: "var(--cat-blue)", bg: read("--key-blue") },
    { name: "Programs and system", color: "var(--cat-green)", bg: read("--key-green") },
    { name: "OBS", color: "var(--cat-teal)", bg: "#134a4f" },
    { name: "Discord", color: "var(--cat-indigo)", bg: read("--key-discord") },
    { name: "Temporary responses", color: "var(--cat-violet)", bg: read("--key-violet") },
    { name: "Pages and logic", color: "var(--cat-orange)", bg: "#3d3027" },
    { name: "Other", color: "var(--cat-gray)", bg: read("--key-graphite") },
  ];
  for (const [name, g] of Object.entries(schema?.plugin_groups ?? {})) {
    if (base.some((x) => x.name === name)) continue;
    base.splice(base.length - 1, 0, { name, color: String(g.color), bg: darker(g.color, 0.5) });
  }
  return base;
}

export const groupOf = (groups: Group[], defs: Record<string, ActionDef>, type: string): Group =>
  groups.find((g) => g.name === (defs[type]?.group ?? "")) ?? (groups.find((g) => g.name === "Other") as Group);

/** As ações da biblioteca por categoria (sem "sequência" e "nada"), filtradas pela busca já normalizada. */
export function groupedActions(defs: Record<string, ActionDef>, groups: Group[], nq: string, norm: (s: unknown) => string, t: T) {
  const by: Record<string, [string, ActionDef][]> = {};
  for (const [type, d] of Object.entries(defs)) {
    if (type === "multi" || type === "none") continue;
    // procura no texto traduzido (como no atual, onde o schema já chega traduzido)
    if (nq && ![t(d.label), type, d.group, d.help ? t(d.help) : undefined].some((s) => norm(s).includes(nq))) continue;
    (by[d.group ?? "Other"] ??= []).push([type, d]);
  }
  return groups.filter((g) => by[g.name]).map((g) => [g, by[g.name] as [string, ActionDef][]] as const);
}

// ---------------------------------------------------------------------------- textos e ícones automáticos

const ACTION_ICON: Record<string, string> = {
  hotkey: "keyboard", bind: "command", text: "text-cursor-input", media: "music", launch: "app-window", command: "terminal",
  http: "webhook", delay: "timer", multi: "list-ordered", toggle: "toggle-right", if: "split", set_state: "flag",
  page: "layers", brightness: "sun", none: "ban", "obs.scene": "monitor", "obs.record": "circle-dot", "obs.stream": "radio",
  "obs.replay": "rewind", "obs.virtualcam": "video", "obs.mute": "volume-x", "obs.source": "eye", "obs.request": "code",
  "discord.mute": "mic", "discord.deafen": "headphones", "discord.keybind": "keyboard",
};

export const iconOf = (defs: Record<string, ActionDef>, type: string): string => ACTION_ICON[type] ?? defs[type]?.icon ?? "settings";

/** Mesmas regras do app/actions.normalize: texto "tipo:valor", lista = sequência. */
export function normalizeAction(spec: unknown): Obj | null {
  if (spec === null || spec === undefined || spec === "") return null;
  if (Array.isArray(spec)) return { type: "multi", actions: spec };
  if (typeof spec === "string") {
    const i = spec.indexOf(":");
    const kind = i < 0 ? spec : spec.slice(0, i);
    const arg = i < 0 ? "" : spec.slice(i + 1);
    const field =
      ({ page: "page", hotkey: "keys", launch: "target", text: "text", media: "key", command: "command", "obs.scene": "scene" } as Record<string, string>)[kind] ??
      "value";
    return arg ? { type: kind, [field]: arg } : { type: kind };
  }
  return spec as Obj;
}

/** O nome que a tecla ganha sozinha para uma ação. */
export function autoText(t: T, defs: Record<string, ActionDef>, spec: unknown): string {
  const a = normalizeAction(spec);
  if (!a) return "";
  const type = String(a.type);
  const base = (p: unknown) =>
    String(p ?? "")
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.(exe|lnk|bat|cmd)$/i, "") ?? "";
  const media: Record<string, string> = {
    play_pause: t("Play"), next: t("Next"), prev: t("Previous"), stop: t("Stop"), vol_up: t("Vol +"), vol_down: t("Vol −"), mute: t("Mute"),
  };
  const fixed: Record<string, string> = {
    hotkey: t("Shortcut"), bind: t("Shortcut"), text: t("Text"), command: t("Command"), http: t("Webhook"), delay: t("Wait"),
    multi: t("Sequence"), toggle: t("On/off"), if: t("If…"), set_state: t("State"), brightness: t("Brightness"), none: "",
    media: media[String(a.key)] ?? t("Media"),
    launch: a.target ? base(a.target) || t("Open") : t("Open"),
    page: a.page === "back" ? t("Back") : a.page === "home" ? t("Home") : (a.page as string) || t("Page"),
    "obs.scene": (a.scene as string) || t("Scene"), "obs.record": t("Record"), "obs.stream": t("Live"),
    "obs.replay": a.mode === "save" ? t("Save replay") : t("Replay"), "obs.virtualcam": t("Camera"),
    "obs.mute": (a.input as string) || t("Mute##2"), "obs.source": (a.source as string) || t("Source"), "obs.request": "OBS",
    "discord.mute": t("Mic"), "discord.deafen": t("Audio"), "discord.keybind": "Discord",
  };
  if (type in fixed) return fixed[type] as string;
  // plugins: o nome curto do plugin.json (como está) ou o nome traduzido (o atual traduz só o label no schema)
  const d = defs[type];
  return d?.short ? d.short : d?.label ? t(d.label) : type;
}

export interface IconSpec {
  lucide?: string;
  text?: string;
  bg?: string;
}

export function autoIcon(t: T, defs: Record<string, ActionDef>, groups: Group[], spec: unknown): IconSpec {
  const a = normalizeAction(spec) ?? { type: "none" };
  const type = String(a.type);
  const icon: IconSpec = { lucide: iconOf(defs, type), text: autoText(t, defs, a), bg: groupOf(groups, defs, type).bg };
  if (type === "page" && a.page === "back") icon.lucide = "arrow-left";
  return icon;
}

export function autoActive(t: T, spec: unknown): IconSpec | null {
  const a = normalizeAction(spec);
  const by: Record<string, IconSpec> = {
    "discord.mute": { lucide: "mic-off", text: t("Muted"), bg: "#e5484d" },
    "discord.deafen": { text: t("No audio"), bg: "#e5484d" },
    "obs.scene": { bg: "#2f9e6a" }, "obs.source": { bg: "#2f9e6a" },
    "obs.record": { text: t("Recording"), bg: "#e5484d" }, "obs.stream": { text: t("LIVE"), bg: "#e5484d" },
    "obs.mute": { lucide: "volume-x", bg: "#e5484d" }, toggle: { bg: "#2f9e6a" },
  };
  return (a && by[String(a.type)]) ?? null;
}

// ---------------------------------------------------------------------------- passo novo e pôr na tecla

export interface StepContext {
  pages: string[]; // os nomes das páginas
  page: string | null; // a página aberta
  scenes: string[]; // as cenas do OBS (vazio se o OBS não está ligado)
}

/** O passo novo de um tipo, já com o que dá para preencher sozinho. */
export function newStep(defs: Record<string, ActionDef>, type: string, ctx: StepContext): Obj {
  if (type === "if") return { type, value: "", op: "eq", to: true, then: [], else: [] };
  if (type === "toggle") return { type, on: [], off: [] };
  if (type === "multi") return { type, actions: [] };
  const s: Obj = { type };
  if (type === "delay") s.ms = 500;
  for (const f of defs[type]?.fields ?? []) {
    if (f.required && f.kind === "enum" && f.options?.length) s[f.name] = f.options[0]?.[0];
    if (f.kind === "page") s[f.name] = ctx.pages.find((p) => p !== ctx.page) ?? "back";
    if (f.kind === "scene" && ctx.scenes.length) s[f.name] = ctx.scenes[0];
  }
  return s;
}

/** Os passos com atalho a gerar (bind sempre; ação com atalho próprio só se ainda não tem), em ordem. */
export function stepsNeedingBind(defs: Record<string, ActionDef>, steps: unknown[]): Obj[] {
  const found: Obj[] = [];
  const ownBind = (s: Obj) => (defs[String(s.type)]?.fields ?? []).some((f) => f.kind === "bind" && f.name === "keys");
  const walk = (s: unknown) => {
    if (!isObj(s)) return;
    if (s.type === "bind" || (ownBind(s) && !s.keys)) found.push(s);
    const kids = [s.actions, s.then, s.else, s.on, s.off].flatMap((v) => (Array.isArray(v) ? v : []));
    for (const c of kids) walk(c);
  };
  steps.forEach(walk);
  return found;
}

/** O passo como o editor trabalha (if/toggle/multi com listas de passos); o contrário de toSpec. */
export function fromSpec(a: unknown): Obj {
  const n: Obj = clone(normalizeAction(a)) ?? { type: "none" };
  if (n.type === "if") {
    n.then = ((n.then as unknown[] | undefined) ?? []).map(fromSpec);
    n.else = ((n.else as unknown[] | undefined) ?? []).map(fromSpec);
  } else if (n.type === "toggle") {
    n.on = toList(n.on);
    n.off = toList(n.off);
  } else if (n.type === "multi") n.actions = ((n.actions as unknown[] | undefined) ?? []).map(fromSpec);
  return n;
}

/** Uma ação do config como lista de passos (sequência vira os passos dela; nada vira lista vazia). */
export function toList(a: unknown): Obj[] {
  const n = normalizeAction(a);
  if (!n) return [];
  return n.type === "multi" ? ((n.actions as unknown[] | undefined) ?? []).map(fromSpec) : [fromSpec(n)];
}

/** Lista de passos de volta para o config: vazia = null, um = ele, vários = sequência. */
export function collapse(list: unknown): Obj | null {
  const l = (Array.isArray(list) ? list : []).map((x) => toSpec(x as Obj));
  return !l.length ? null : l.length === 1 ? (l[0] as Obj) : { type: "multi", actions: l };
}

export const MOMENTS = ["action", "double", "hold", "release"] as const;

/** O passo como vai para o config (toggle com listas vira on/off; if sem then/else perde o campo). */
export function toSpec(step: Obj): Obj {
  const s: Obj = { ...step };
  if (s.type === "if") {
    s.then = (s.then as Obj[]).map(toSpec);
    s.else = (s.else as Obj[]).map(toSpec);
    if (!(s.then as Obj[]).length) delete s.then;
    if (!(s.else as Obj[]).length) delete s.else;
  } else if (s.type === "toggle") {
    const on = collapse(s.on);
    const off = collapse(s.off);
    if (on) s.on = on;
    else delete s.on;
    if (off) s.off = off;
    else delete s.off;
  } else if (s.type === "multi") s.actions = (s.actions as Obj[]).map(toSpec);
  return s;
}

const firstStep = (a: unknown): Obj | null => {
  const n = normalizeAction(a);
  if (!n) return null;
  return n.type === "multi" ? (normalizeAction((n.actions as unknown[] | undefined)?.[0]) ?? null) : n;
};

/** Põe a ação `step` na tecla `k` (no rascunho). Tecla nova ganha nome, ícone e cor; tecla que já existe troca a
 * ação e, se o nome era o automático (ou não tinha), o ícone acompanha. Devolve se a tecla já existia. */
export function assignAction(keys: PageKeys, k: string, step: Obj, t: T, defs: Record<string, ActionDef>, groups: Group[]): boolean {
  const old = keys[k];
  if (!old) {
    const spec: KeySpec = { icon: autoIcon(t, defs, groups, step), action: toSpec(step) };
    const act = autoActive(t, step);
    if (act) spec.active_icon = act;
    keys[k] = spec;
    return false;
  }
  const oldFirst = firstStep(old.action);
  const icon = normalizeIcon(old.icon);
  const wasAuto = !oldFirst || icon.text === autoText(t, defs, oldFirst) || !icon.text;
  old.action = toSpec(step);
  if (wasAuto) {
    const next: Obj = { ...icon, ...autoIcon(t, defs, groups, step) };
    delete next.glyph; // o ícone automático é do Lucide; tira o Segoe antigo
    old.icon = next;
    const act = autoActive(t, step);
    if (act) old.active_icon = act;
    else delete old.active_icon;
  }
  return true;
}

// ---------------------------------------------------------------------------- peças (widget, tecla guardada)

export interface Removed {
  key: string;
  spec: KeySpec;
}

/** Tira tudo o que estiver nessas teclas (blocos inteiros, menos `except`); devolve o que saiu. */
export function clearKeys(keys: PageKeys, list: string[], except?: string): Removed[] {
  const cov = coverMap(keys);
  const anchors = new Set<string>();
  for (const k of list) {
    if (keys[k] && k !== except) anchors.add(k);
    else if (cov[k] && cov[k][0] !== except) anchors.add(cov[k][0]);
  }
  const removed: Removed[] = [];
  for (const a of anchors) {
    removed.push({ key: a, spec: keys[a] as KeySpec });
    Reflect.deleteProperty(keys, a);
  }
  return removed;
}

export interface Footprint {
  ok: boolean; // cabe (não passa da borda)
  cells: string[]; // as casas que a peça ocupa
  replace: string[]; // dessas, as que já têm tecla (ou são de um bloco)
}

/** Onde uma peça cols×rows cairia a partir de `anchor`: as casas e quais delas vão ser substituídas. */
export function footprintAt(keys: PageKeys, anchor: string, cols: number, rows: number): Footprint {
  const cells = footprint(anchor, cols, rows);
  if (!cells) return { ok: false, cells: [anchor], replace: [] };
  const cov = coverMap(keys);
  return { ok: true, cells, replace: cells.filter((k) => !!(keys[k] ?? cov[k])) };
}

/** Os modelos de widget: os do app e dos plugins (schema) e os da pessoa (config: widgets). */
export function widgetDefs(schema: EditorSchema | undefined, cfg: Config | null): Record<string, Obj> {
  const out: Record<string, Obj> = { ...(schema?.widgets ?? {}) };
  for (const [id, d] of Object.entries(isObj(cfg?.widgets) ? cfg.widgets : {})) {
    if (!isObj(d) || !isObj(d.sizes)) continue;
    out[id] = { label: d.label || id, icon: d.icon || "layout-grid", category: "mine", mine: true, plugin: null, options: [], sizes: d.sizes, action: d.action, hold: d.hold };
  }
  return out;
}

export const keyId = (page: string, key: string): string => `${page}-${key}`.replace(/[^A-Za-z0-9_-]/g, "_");
const usesId = (d: Obj): boolean => JSON.stringify([d.sizes, d.action, d.hold]).includes("$id");
export const needsExpand = (d: Obj): boolean => !!(d.action || d.hold);

/** A tecla de um widget colocado (sem as ações padrão, que vêm do servidor quando o modelo tem). */
export function widgetSpec(d: Obj, id: string, size: string, page: string, anchor: string): KeySpec {
  const spec: KeySpec = { widget: id, size };
  if (usesId(d)) spec.options = { id: keyId(page, anchor) };
  return spec;
}

/** cols×rows de um tamanho "2x3" (2 linhas, 3 colunas). */
export const sizeColsRows = (size: string): [number, number] => {
  const [r, c] = sizeRC(size);
  return [c, r];
};

export interface SavedKey {
  name: string;
  key: KeySpec;
}

export const savedKeys = (cfg: Config | null): SavedKey[] => (Array.isArray(cfg?.saved_keys) ? (cfg.saved_keys as SavedKey[]) : []);

/** Uma cópia da tecla guardada e quantas casas ela ocupa. */
export function savedPiece(item: SavedKey): { spec: KeySpec; cols: number; rows: number } {
  const spec = clone(item.key);
  const [cols, rows] = spanOf(spec);
  return { spec, cols, rows };
}

export const pageNames = (cfg: Config | null): string[] => Object.keys(pagesOf(cfg));
