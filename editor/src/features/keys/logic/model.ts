// "O que faz" como dados: cada momento da tecla (apertar, toque duplo, segurar, soltar) vira uma lista de passos
// (toList); um passo "Se", "liga/desliga" ou "sequência" tem listas dentro dele. Uma lista é achada por um
// caminho: [momento, índice do passo, campo, índice, campo, ...]. Mexer = montar as listas de novo a partir do
// config, mudar e gravar de volta (collapse), com as regras do commitModel do editor atual: o nome automático
// acompanha a primeira ação, e "repetir enquanto segura" sai quando o que sobrou não dá para repetir.
import { isObj, normalizeIcon, type Obj } from "@/core/obj";
import { MOMENTS, autoText, collapse, normalizeAction, toList, type ActionDef } from "@/features/keys/actions";
import type { KeySpec } from "@/features/keys/model";

export type Moment = (typeof MOMENTS)[number];
/** Campos de um passo que guardam listas de passos. */
export type ListField = "then" | "else" | "on" | "off" | "actions";
/** [momento, ...pares (índice do passo, campo da lista)]. */
export type ListPath = [Moment, ...(number | ListField)[]];

export type Model = Record<Moment, Obj[]>;

export const modelOf = (spec: KeySpec): Model =>
  Object.fromEntries(MOMENTS.map((m) => [m, toList(spec[m])])) as Model;

/** A lista que o caminho aponta (dentro do modelo). */
export function listAt(model: Model, path: ListPath): Obj[] {
  let list: Obj[] = model[path[0]];
  for (let i = 1; i + 1 < path.length; i += 2) {
    const step = list[path[i] as number];
    const field = path[i + 1] as ListField;
    if (!isObj(step)) return [];
    if (!Array.isArray(step[field])) step[field] = [];
    list = step[field] as Obj[];
  }
  return list;
}

/** O passo está (em algum nível) dentro da lista? (um bloco não pode ir para dentro dele mesmo) */
export function containsList(step: unknown, list: Obj[]): boolean {
  if (!isObj(step)) return false;
  for (const f of ["actions", "then", "else", "on", "off"] as const) {
    const l = step[f];
    if (!Array.isArray(l)) continue;
    if (l === list) return true;
    if (l.some((s) => containsList(s, list))) return true;
  }
  return false;
}

const REPEAT_MEDIA = ["vol_up", "vol_down", "next", "prev"];

/** Dá para repetir enquanto segura? (volume, faixa, atalho; plugins marcam no plugin.json) */
export function repeatable(defs: Record<string, ActionDef>, list: Obj[]): boolean {
  return (
    list.length > 0 &&
    list.every((s) => {
      const a = normalizeAction(s);
      if (!a) return false;
      if (a.type === "hotkey") return true;
      if (a.type === "media") return REPEAT_MEDIA.includes(String(a.key));
      return !!(defs[String(a.type)] as Obj | undefined)?.repeatable;
    })
  );
}

/** Grava o modelo de volta na tecla (no rascunho), com as regras do commitModel do atual. */
export function commitModel(spec: KeySpec, model: Model, defs: Record<string, ActionDef>, t: (s: string, a?: unknown[]) => string): void {
  const before = toList(spec.action)[0];
  for (const m of MOMENTS) {
    const v = collapse(model[m]);
    if (v) spec[m] = v;
    else Reflect.deleteProperty(spec, m);
  }
  if (spec.repeat === "press" && !repeatable(defs, model.action)) delete spec.repeat;
  if (spec.repeat === "hold" && !repeatable(defs, model.hold)) delete spec.repeat;
  if (!spec.repeat) {
    delete spec.repeat_ms;
    delete spec.repeat_delay;
  }
  // nome automático acompanha a ação (escolheu a cena "Pausa": a tecla vira "Pausa")
  const first = model.action[0];
  if (!first) return;
  const icon = normalizeIcon(spec.icon);
  // como no atual: só quando já havia uma primeira ação e o nome era exatamente o automático dela
  if (before === undefined || icon.text !== autoText(t, defs, before)) return;
  const next = autoText(t, defs, first);
  if (next !== icon.text) spec.icon = { ...icon, text: next };
}

/** Os campos que a frase do passo já mostra (o resto vai para "mais opções"). */
export const SENTENCE_FIELDS: Record<string, string[]> = {
  hotkey: ["keys"], bind: ["keys"], text: ["text"], media: ["key"], launch: ["target"], command: ["command"],
  http: ["url"], delay: ["ms"], page: ["page"], brightness: ["value"], set_state: ["state", "value"],
  "light.flash": ["color", "seconds"], "screens.paint": ["color", "seconds"], "page.temp": ["page", "seconds"],
  "timer.toggle": ["id", "minutes"], "timer.reset": ["id"],
  "obs.scene": ["scene"], "obs.record": ["mode"], "obs.stream": ["mode"], "obs.replay": ["mode"],
  "obs.virtualcam": ["mode"], "obs.mute": ["mode", "input"], "obs.source": ["mode", "source", "scene"],
  "obs.request": ["request"], "discord.keybind": ["name"],
};

/** Um nome da tecla pelo código ("KeyA" -> "a"), para gravar atalhos; null para Ctrl/Shift/Alt/Win sozinhos. */
export function keyName(code: string): string | null {
  if (/^(Control|Shift|Alt|Meta|OS)/.test(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();
  if (/^Numpad\d$/.test(code)) return "num" + code.slice(6);
  const named: Record<string, string> = {
    Space: "space", Enter: "enter", Tab: "tab", Backspace: "backspace", Delete: "delete", Insert: "insert",
    Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown", ArrowLeft: "left", ArrowRight: "right",
    ArrowUp: "up", ArrowDown: "down", PrintScreen: "printscreen", Pause: "pause", Minus: "-", Equal: "=",
    Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]",
    Backslash: "\\", Backquote: "`", NumpadAdd: "add", NumpadSubtract: "subtract", NumpadMultiply: "multiply",
    NumpadDivide: "divide", NumpadDecimal: "decimal", CapsLock: "capslock", MediaPlayPause: "play_pause",
    MediaTrackNext: "next", MediaTrackPrevious: "prev", AudioVolumeUp: "vol_up", AudioVolumeDown: "vol_down",
    AudioVolumeMute: "mute",
  };
  return named[code] ?? null;
}

/** O atalho de uma tecla apertada ("ctrl+shift+m"), ou null. */
export function comboOf(e: { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): string | null {
  const name = keyName(e.code);
  if (!name) return null;
  return [e.ctrlKey && "ctrl", e.shiftKey && "shift", e.altKey && "alt", e.metaKey && "win", name].filter(Boolean).join("+");
}
