import { describe, expect, it } from "vitest";
import { norm } from "@/core/icons/lucide";
import {
  actionDefs,
  assignAction,
  autoText,
  clearKeys,
  footprintAt,
  groupedActions,
  groupsOf,
  newStep,
  stepsNeedingBind,
  widgetDefs,
  widgetSpec,
} from "@/features/keys/actions";
import type { PageKeys } from "@/features/keys/model";

const t = (s: string) => s;
const read = (n: string) => ({ "--key-blue": "#22336E", "--key-graphite": "#1D2330" })[n] ?? "#000000";
const SCHEMA = {
  actions: {
    hotkey: { label: "Keyboard shortcut", group: "Keyboard and text" },
    "obs.scene": { label: "Scene", group: "OBS", fields: [{ name: "scene", kind: "scene" }] },
    "discord.mute": { label: "Mute", group: "Discord", fields: [{ name: "keys", kind: "bind" }] },
    "weather.now": { label: "Weather now", short: "Clima", group: "Weather" },
    multi: { label: "Seq" },
  },
  plugin_groups: { Weather: { color: "#3399ff", icon: "cloud" } },
  widgets: { "app.timer": { label: "Timer", sizes: { "1x1": { text: "$id" } }, action: { type: "timer.toggle", id: "$id" } } },
} as never;
const defs = actionDefs(SCHEMA);
const groups = groupsOf(SCHEMA, read);

describe("categorias e busca", () => {
  it("as dos plugins entram antes de Other, com o fundo mais escuro", () => {
    expect(groups.map((g) => g.name).slice(-2)).toEqual(["Weather", "Other"]);
    expect(groups.find((g) => g.name === "Weather")?.bg).toBe("#1A4D80");
  });
  it("busca agrupada, sem a sequência", () => {
    expect(groupedActions(defs, groups, "", norm, t).map(([g]) => g.name)).toEqual(["Keyboard and text", "OBS", "Discord", "Weather"]);
    expect(groupedActions(defs, groups, norm("scéne"), norm, t).map(([, items]) => items.map(([ty]) => ty))).toEqual([["obs.scene"]]);
  });
});

describe("pôr uma ação na tecla", () => {
  it("tecla nova ganha nome, ícone, cor e o visual de ligada", () => {
    const keys: PageKeys = {};
    const existed = assignAction(keys, "3", newStep(defs, "obs.scene", { pages: [], page: null, scenes: ["Pausa"] }), t, defs, groups);
    expect(existed).toBe(false);
    expect(keys["3"]).toEqual({
      icon: { lucide: "monitor", text: "Pausa", bg: "#134a4f" },
      action: { type: "obs.scene", scene: "Pausa" },
      active_icon: { bg: "#2f9e6a" },
    });
  });
  it("tecla com nome próprio guarda o nome; com nome automático, o ícone acompanha", () => {
    const keys: PageKeys = {
      "1": { icon: { text: "Meu" }, action: "hotkey:a" },
      "2": { icon: { text: "Shortcut", glyph: "E720" }, action: "hotkey:a" },
    };
    assignAction(keys, "1", { type: "weather.now" }, t, defs, groups);
    assignAction(keys, "2", { type: "weather.now" }, t, defs, groups);
    expect(keys["1"]).toEqual({ icon: { text: "Meu" }, action: { type: "weather.now" } });
    expect(keys["2"]?.icon).toEqual({ text: "Clima", lucide: "settings", bg: "#1A4D80" }); // sem o glyph antigo
  });
  it("nome curto do plugin não é traduzido", () => {
    expect(autoText((s) => `[${s}]`, defs, "weather.now")).toBe("Clima");
  });
  it("atalho a gerar: bind sempre; atalho próprio só se não tem", () => {
    const steps = [{ type: "bind" }, { type: "discord.mute" }, { type: "discord.mute", keys: "f13" }, { type: "toggle", on: [{ type: "bind" }] }];
    expect(stepsNeedingBind(defs, steps)).toHaveLength(3);
  });
});

describe("peças", () => {
  const keys = (): PageKeys => ({ "1": { widget: "app.clock", size: "2x2" }, "4": { icon: "A" } });
  it("onde cai: casas, o que é substituído e quando passa da borda", () => {
    expect(footprintAt(keys(), "3", 2, 2)).toEqual({ ok: true, cells: ["3", "4", "8", "9"], replace: ["4"] });
    expect(footprintAt(keys(), "6", 2, 1)).toEqual({ ok: true, cells: ["6", "7"], replace: ["6", "7"] });
    expect(footprintAt(keys(), "5", 2, 1).ok).toBe(false);
  });
  it("tirar o lugar leva o bloco inteiro", () => {
    const k = keys();
    expect(clearKeys(k, ["7"]).map((r) => r.key)).toEqual(["1"]);
    expect(k).toEqual({ "4": { icon: "A" } });
  });
  it("widget com $id ganha o id da tecla", () => {
    const d = widgetDefs(SCHEMA, null)["app.timer"] as Record<string, unknown>;
    expect(widgetSpec(d, "app.timer", "1x1", "main page", "3")).toEqual({ widget: "app.timer", size: "1x1", options: { id: "main_page-3" } });
  });
});
