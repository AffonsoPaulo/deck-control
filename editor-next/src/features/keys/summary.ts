// Uma linha que resume um passo ("Cena Jogo", "500 ms", "3 passos"): na lista das Automações. Mesmas regras do
// summarize do editor atual.
import type { Swatch } from "@/components/Swatches";
import { normalizeAction, type ActionDef } from "@/features/keys/actions";
import type { ValueDef } from "@/features/keys/values";
import { valueLabel } from "@/features/keys/values";

type T = (s: string, a?: unknown[]) => string;

export interface SummaryCtx {
  defs: Record<string, ActionDef>;
  values: ValueDef[];
  states: [string, string][]; // stateOptions
  swatches: Swatch[]; // as cores de tecla, para dizer o nome da cor
}

function optionLabel(c: SummaryCtx, type: string, field: string, value: unknown): unknown {
  const f = c.defs[type]?.fields?.find((x) => x.name === field);
  const o = f?.options?.find(([v]) => JSON.stringify(v) === JSON.stringify(value));
  return o ? o[1] : value;
}

export function colorName(t: T, swatches: Swatch[], hex: unknown): string {
  const all: [string, string][] = [...swatches.map((s) => [s.value, s.label] as [string, string]), ["#22c55e", t("green")], ["#ef4444", t("red")], ["#b4232a", t("red")], ["#F5A524", t("orange")]];
  const hit = all.find(([c]) => c.toLowerCase() === String(hex ?? "").toLowerCase());
  return hit ? hit[1].toLowerCase() : typeof hex === "string" ? hex : "";
}

function stateLabel(c: SummaryCtx, v: unknown): string {
  const o = c.states.find(([s]) => s === v);
  return o ? o[1].charAt(0).toLowerCase() + o[1].slice(1) : String(v);
}

export function summarize(t: T, c: SummaryCtx, spec: unknown): string {
  const a = normalizeAction(spec);
  if (!a) return t("nothing");
  const type = String(a.type);
  const d = c.defs[type];
  const label = d ? t(d.label) : type;
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  switch (type) {
    case "media":
      return t(s(optionLabel(c, "media", "key", a.key))) + (Number(a.repeat) > 1 ? t(" ({0}×)", [a.repeat]) : "");
    case "hotkey":
      return a.keys ? (Array.isArray(a.keys) ? a.keys.join(", ") : s(a.keys)) : t("missing the shortcut");
    case "bind":
      return a.keys ? t("Shortcut {0}", [a.keys]) : label;
    case "text":
      return a.text ? `"${s(a.text).slice(0, 24)}"` : t("missing the text");
    case "launch":
      return a.target ? (s(a.target).split(/[\\/]/).pop() ?? "") : t("missing the program");
    case "page":
      return a.page === "back" ? t("Back one page") : a.page === "home" ? t("Home page") : t("Page {0}", [a.page]);
    case "obs.scene":
      return a.scene ? t("Scene {0}", [a.scene]) : t("missing the scene");
    case "obs.mute":
      return s(a.input) || t("missing the audio source");
    case "obs.source":
      return a.source ? t("{0} in {1}", [a.source, a.scene || "?"]) : t("missing the source");
    case "delay":
      return a.ms ? `${s(a.ms)} ms` : t("missing the time");
    case "multi":
      return t("{0} steps", [((a.actions as unknown[] | undefined) ?? []).length]);
    case "if":
      return a.value
        ? t("If {0}", [valueLabel(c.values, s(a.value))])
        : a.state
          ? a.is === false
            ? t("If not: {0}", [stateLabel(c, a.state)])
            : t("If {0}", [stateLabel(c, a.state)])
          : t("missing the condition");
    case "light.flash":
      return t("Light {0} for {1} s", [colorName(t, c.swatches, a.color), a.seconds ?? 3]);
    case "screens.paint":
      return t("Paint the keys {0} for {1} s", [colorName(t, c.swatches, a.color), a.seconds ?? 3]);
    case "page.temp":
      return t("Page {0} for {1} s", [a.page || "?", a.seconds ?? 10]);
    case "timer.toggle":
      return t("Countdown {0}", [a.id || "?"]);
    case "timer.reset":
      return t("Reset countdown {0}", [a.id || "?"]);
    case "obs.record":
    case "obs.stream":
    case "obs.replay":
    case "obs.virtualcam":
      return a.mode && a.mode !== "toggle" ? t(s(optionLabel(c, type, "mode", a.mode))) : t("Toggle");
    default:
      return d?.help ? (t(d.help).split(".")[0] ?? label) : label;
  }
}
