// Pôr coisas no Deck: uma ação numa tecla, um widget num tamanho, uma tecla guardada; e guardar teclas para usar
// depois. Cada uma vira uma entrada do desfazer, escolhe a tecla e avisa (com "Desfazer"). Mesmos textos e regras
// do editor atual (assignAction, placeWidget, placeSaved, placedToast, saveSpec).
import { api } from "@/core/api";
import type { EditorSchema } from "@/core/api-types";
import { useT } from "@/core/i18n";
import { useObs, useSchema } from "@/core/queries";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { undoButton } from "@/core/store/undo";
import { toast } from "@/core/toast";
import {
  actionDefs,
  assignAction,
  clearKeys,
  groupsOf,
  needsExpand,
  newStep,
  pageNames,
  savedKeys,
  savedPiece,
  sizeColsRows,
  stepsNeedingBind,
  widgetDefs,
  widgetSpec,
  type Removed,
} from "@/features/keys/actions";
import { useLib } from "@/features/keys/libStore";
import { footprint, type DropResult, type KeySpec } from "@/features/keys/model";
import { draftKeys } from "@/features/keys/keys";

type T = ReturnType<typeof useT>;
type Obj = Record<string, unknown>;

const TOKEN_RE = /\{([A-Za-z0-9_.:\-$]+)(?:\|([a-z0-9]+))?\}/g;

/** Guarda uma tecla em "Teclas guardadas" (config: saved_keys), com o nome do ícone (valores viram o nome deles). */
export function saveSpec(spec: KeySpec, t: T, schema: EditorSchema | undefined, name?: string): void {
  const icon = typeof spec.icon === "string" ? { text: spec.icon } : ((spec.icon as Obj | undefined) ?? {});
  const label = (id: string) => String((schema?.values.find((v) => v.id === id) as Obj | undefined)?.label ?? id);
  const n = name ?? String(icon.text ?? t("Key")).replace(/\n/g, " ").replace(TOKEN_RE, (_, id: string) => label(id));
  useConfig.getState().edit((d) => {
    const list = (Array.isArray(d.saved_keys) ? d.saved_keys : (d.saved_keys = [])) as unknown[];
    list.push({ name: n, key: JSON.parse(JSON.stringify(spec)) as unknown });
  });
  useLib.getState().openGroup("Saved keys");
}

/** O aviso de "peça colocada" já com o idioma e o schema (para quem troca o tamanho de um widget). */
export const placedToastFor = (t: T, schema: EditorSchema | undefined) => (msg: string, removed: Removed[]) => placedToast(msg, removed, t, schema);

/** O aviso depois de colocar uma peça; se tirou teclas, oferece guardá-las. */
function placedToast(msg: string, removed: Removed[], t: T, schema: EditorSchema | undefined): void {
  if (!removed.length) {
    toast(msg, { undo: undoButton(t) });
    return;
  }
  const n = removed.length === 1 ? t("1 key was replaced.") : t("{0} keys were replaced.", [removed.length]);
  toast(`${msg} ${n}`, {
    undo: undoButton(t),
    action: {
      label: t("Keep the replaced ones"),
      run: () => {
        removed.forEach((r) => saveSpec(r.spec, t, schema));
        toast(t("Saved in Saved keys, in the library."));
      },
    },
  });
}

/** Dá atalhos novos (F13–F24, sem bater com os do config) aos passos que precisam. */
export async function fillBinds(steps: Obj[], t: T, schema: EditorSchema | undefined): Promise<number> {
  const defs = actionDefs(schema);
  const programs = (schema?.plugins ?? []) as Obj[];
  const rulesOf = (s: Obj) =>
    s.type === "bind"
      ? ((programs.find((p) => p.id === s.for)?.shortcut_rules as Obj | undefined) ?? null)
      : (((defs[String(s.type)] as Obj | undefined)?.shortcut_rules as Obj | undefined) ?? null);
  const taken: string[] = [];
  const found = stepsNeedingBind(defs, steps);
  for (const s of found) {
    try {
      const { combos } = await api("POST /api/free_bind", { config: useConfig.getState().cfg ?? {}, count: 1, rules: rulesOf(s), taken });
      const c = combos[0];
      if (c) {
        s.keys = c;
        taken.push(c);
      }
    } catch (e) {
      toast(t("No free shortcuts left: ") + (e as Error).message, { bad: true });
    }
  }
  return found.length;
}

/** As operações de colocar, para a página aberta. */
export function usePlacer(page: string) {
  const t = useT();
  const schema = useSchema().data;
  const obs = useObs();
  const go = useUi((s) => s.go);
  const edit = useConfig((s) => s.edit);

  const assign = async (k: string, type: string) => {
    const defs = actionDefs(schema);
    const cfg = useConfig.getState().cfg;
    const step = newStep(defs, type, { pages: pageNames(cfg), page, scenes: obs.scenes });
    await fillBinds([step], t, schema);
    let existed = false;
    edit((d) => {
      existed = assignAction(draftKeys(d, page), k, step, t, defs, groupsOf(schema));
    });
    const now = useConfig.getState().cfg;
    const isWidget = !!(now && (draftKeys(now, page)[k] as Obj | undefined)?.widget);
    go({ key: k, tab: isWidget ? "look" : "do", lookMode: "normal" });
    const label = defs[type] ? t(defs[type].label) : type;
    toast(existed ? t("Key {0} now does: {1}.", [k, label]) : t("Key {0} created: {1}.", [k, label]), { undo: undoButton(t) });
  };

  const placeWidget = async (anchor: string, id: string, size: string) => {
    const cfg = useConfig.getState().cfg;
    const d = widgetDefs(schema, cfg)[id];
    if (!d || !(d.sizes as Obj)[size]) return;
    const [cols, rows] = sizeColsRows(size);
    const cells = footprint(anchor, cols, rows);
    if (!cells) {
      toast(t("It doesn't fit there: the piece goes past the edge."), { bad: true });
      return;
    }
    const spec = widgetSpec(d, id, size, page, anchor);
    if (needsExpand(d)) {
      try {
        const built = await api("POST /api/widget/expand", {
          key: { widget: id, size, options: spec.options ?? null, colors: null },
          widgets: (cfg?.widgets as Obj | undefined) ?? null,
          id: null,
        });
        if (built.action) spec.action = built.action;
        if (built.hold) spec.hold = built.hold;
      } catch (e) {
        toast(t("Couldn't place the widget: ") + (e as Error).message, { bad: true });
        return;
      }
    }
    let removed: Removed[] = [];
    edit((dr) => {
      const keys = draftKeys(dr, page);
      removed = clearKeys(keys, cells);
      keys[anchor] = spec;
    });
    go({ key: anchor, tab: "look", lookMode: "normal" });
    placedToast(t("{0} {1} placed.", [d.label, size.replace("x", "×")]), removed, t, schema);
  };

  const placeSaved = (anchor: string, index: number) => {
    const item = savedKeys(useConfig.getState().cfg)[index];
    if (!item) return;
    const { spec, cols, rows } = savedPiece(item);
    const cells = footprint(anchor, cols, rows);
    if (!cells) {
      toast(t("It doesn't fit there: the piece goes past the edge."), { bad: true });
      return;
    }
    let removed: Removed[] = [];
    edit((dr) => {
      const keys = draftKeys(dr, page);
      removed = clearKeys(keys, cells);
      keys[anchor] = spec;
    });
    go({ key: anchor, tab: "look", lookMode: "normal" });
    placedToast(t("“{0}” placed.", [item.name]), removed, t, schema);
  };

  /** Faz o que o arrasto decidiu (a troca de teclas fica na grade). */
  const run = (r: DropResult) => {
    if (r.op === "assign") void assign(r.key, r.type);
    else if (r.op === "widget") void placeWidget(r.anchor, r.widget, r.size);
    else if (r.op === "saved") placeSaved(r.anchor, r.index);
  };

  return { assign, placeWidget, placeSaved, run };
}
