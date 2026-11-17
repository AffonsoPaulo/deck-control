// A aparência da tecla como dados: se ela tem estado (ligada/desligada), as opções de "Ativa quando", as paletas
// de texto e borda, as direções do degradê e os tamanhos padrão. Mesmas regras do editor atual (app.js:
// keyHasState, stateOptions, activeWhenSelect, FG_SWATCHES, BORDER_SWATCHES, GRAD_DIRS, LAYOUT_DEFAULTS).
import type { EditorSchema } from "@/core/api-types";
import { isObj, normalizeIcon, type Obj } from "@/core/obj";
import type { Config } from "@/core/store/config";
import { MOMENTS, actionDefs, normalizeAction } from "@/features/keys/actions";
import { pagesOf, type KeySpec } from "@/features/keys/model";

type T = (s: string, args?: unknown[]) => string;

/** A tecla acende sozinha (a ação tem estado) ou tem uma condição escolhida. */
export function keyHasState(schema: EditorSchema | undefined, spec: KeySpec | undefined): boolean {
  if (!spec) return false;
  if (spec.state) return true;
  return autoState(schema, spec);
}

/** A ação da tecla traz estado próprio (gravar, mutar...); "salvar replay" não. */
export function autoState(schema: EditorSchema | undefined, spec: KeySpec): boolean {
  const a = normalizeAction(spec.action);
  if (!a) return false;
  const d = actionDefs(schema)[String(a.type)] as Obj | undefined;
  return !!d?.state && !(a.type === "obs.replay" && a.mode === "save");
}

export interface ObsLists {
  scenes: string[];
  inputs: string[];
}

/** As condições que existem: as dos plugins, os liga/desliga das teclas, as cenas e os áudios do OBS. */
export function stateOptions(t: T, schema: EditorSchema | undefined, cfg: Config | null, obs: ObsLists): [string, string][] {
  const out: [string, string][] = [];
  for (const pl of (schema?.plugins ?? []) as Obj[]) for (const st of (pl.states as [string, string][] | undefined) ?? []) out.push([st[0], st[1]]);
  const scenes = new Set(obs.scenes);
  const inputs = new Set(obs.inputs);
  const walk = (raw: unknown, page: string, key: string, spec: KeySpec) => {
    const a = normalizeAction(raw);
    if (!isObj(a)) return;
    if (a.type === "obs.scene" && a.scene) scenes.add(String(a.scene));
    if (a.type === "obs.mute" && a.input) inputs.add(String(a.input));
    if (a.type === "toggle") {
      const st = typeof a.state === "string" && a.state ? a.state : `toggle:${page}:${key}`;
      const text = normalizeIcon(spec.icon).text;
      const name = text ? String(text) : t("key {0}", [key]);
      out.push([st, t('"{0}" ({1}) is on', [name.replace(/\n/g, " "), page])]);
    }
    const kids = [a.actions, a.then, a.else].flatMap((v) => (Array.isArray(v) ? v : [])).concat([a.on, a.off]);
    for (const c of kids) if (c) walk(c, page, key, spec);
  };
  for (const [p, keys] of Object.entries(pagesOf(cfg))) {
    for (const [k, spec] of Object.entries(isObj(keys) ? keys : {})) {
      if (spec) for (const m of MOMENTS) walk((spec as KeySpec)[m], p, k, spec as KeySpec);
    }
  }
  for (const s of scenes) out.push([`obs.scene:${s}`, t("The current scene is {0}", [s])]);
  for (const i of inputs) out.push([`obs.muted:${i}`, t("{0} is muted in OBS", [i])]);
  const seen = new Set<string>();
  return out.filter(([v]) => (seen.has(v) ? false : (seen.add(v), true)));
}

/** As opções do "Ativa quando": automático (pela ação) ou nunca, as condições e a que já está no config. */
export function activeWhenOptions(t: T, schema: EditorSchema | undefined, cfg: Config | null, obs: ObsLists, spec: KeySpec): [string, string][] {
  const opts: [string, string][] = [
    ["", autoState(schema, spec) ? t("automatic (from the action)") : t("never")],
    ...stateOptions(t, schema, cfg, obs).map(([v, l]): [string, string] => [v, l.charAt(0).toLowerCase() + l.slice(1)]),
  ];
  const st = typeof spec.state === "string" ? spec.state : "";
  if (st && !opts.some(([v]) => v === st)) opts.push([st, st]);
  return opts;
}

export const fgSwatches = (t: T) => [
  { value: "#FFFFFF", label: t("White") },
  { value: "#16181D", label: t("Near black") },
  { value: "#F5A524", label: t("Amber") },
  { value: "#E5484D", label: t("Red") },
  { value: "#30A46C", label: t("Green") },
];
export const borderSwatches = (t: T) => [
  { value: "#F5A524", label: t("Amber") },
  { value: "#E5484D", label: t("Red") },
  { value: "#30A46C", label: t("Green") },
  { value: "#FFFFFF", label: t("White") },
];

export type GradDir = "down" | "right" | "diagonal" | "radial";

/** Tamanhos padrão de ícone (px) e imagem (fração da tecla) por posição do texto. */
export const LAYOUT_DEFAULTS: Record<string, { glyph: number; image: number }> = {
  below: { glyph: 48, image: 0.5 },
  top: { glyph: 46, image: 0.48 },
  big: { glyph: 66, image: 0.79 },
};

export type CenterMode = "icon" | "image" | "text";

/** O que vai no centro da tecla. */
export const centerMode = (icon: Obj): CenterMode => (icon.image ? "image" : icon.lucide || icon.glyph ? "icon" : "text");

/** Aplica mudanças no ícone: null/""/lista vazia apagam o campo (o setOrDelete do atual). */
export function patchIcon(icon: Obj, patch: Obj): Obj {
  const out: Obj = { ...icon };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) Reflect.deleteProperty(out, k);
    else out[k] = v;
  }
  return out;
}

const hasTokens = (s: unknown) => typeof s === "string" && /\{[A-Za-z0-9_.:\-$]+(\|[a-z0-9]+)?\}/.test(s);

/** Ícone de informação: subtítulo, barra, fundo por valor, estilo "info" ou texto com valores ({clock.hour}). */
export const isInfoIcon = (ic: Obj): boolean =>
  ic.sub !== undefined || isObj(ic.bar) || isObj(ic.bg) || ic.style === "info" || Object.values(ic).some(hasTokens);

/** Tecla de informação (mostra valores; o editor dela é outro): tem regras ou ícone de informação. */
export const isInfoKey = (spec: KeySpec | undefined): boolean =>
  !!spec && !spec.widget && ((Array.isArray(spec.rules) && spec.rules.length > 0) || isInfoIcon(normalizeIcon(spec.icon)));
