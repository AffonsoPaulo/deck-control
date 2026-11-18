// Mexer num widget já colocado: trocar o tamanho (tira o que estiver no caminho), mudar uma opção (as ações
// padrão acompanham, a não ser que a pessoa tenha mudado a ação), virar bloco comum ("editar tecla por tecla") e
// apagar um dos meus widgets. Mesmas regras do editor atual (setWidgetSize, optionRow, refreshWidgetActions,
// detachWidget, removeUserWidget).
import { api } from "@/core/api";
import { useT } from "@/core/i18n";
import { clone, isObj, type Obj } from "@/core/obj";
import { useSchema } from "@/core/queries";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { undoButton } from "@/core/store/undo";
import { toast } from "@/core/toast";
import { clearKeys, sizeColsRows, widgetDefs, type Removed } from "@/features/keys/actions";
import { draftKeys } from "@/features/keys/keys";
import { coverMap, footprint, pageKeysOf, pagesOf, type KeySpec, type PageKeys } from "@/features/keys/model";
import { placedToastFor } from "@/features/keys/place";

/** Quantas teclas (blocos inteiros) um tamanho tiraria do lugar, sem contar o próprio widget. */
export function countReplaced(keys: PageKeys, cells: string[], anchor: string): number {
  const cov = coverMap(keys);
  const anchors = new Set<string>();
  for (const k of cells) {
    if (k === anchor) continue;
    if (keys[k]) anchors.add(k);
    else if (cov[k] && cov[k][0] !== anchor) anchors.add(cov[k][0]);
  }
  return anchors.size;
}

/** O valor de cada opção agora (o padrão do modelo, por cima o que a tecla tem). */
export const optionValues = (d: Obj, spec: KeySpec): Obj => ({
  ...Object.fromEntries(((d.options as Obj[] | undefined) ?? []).map((o) => [String(o.name), o.default])),
  ...(isObj(spec.options) ? spec.options : {}),
});

/** As opções da tecla depois de mudar uma: vazio ou igual ao padrão some; sem nenhuma, some o campo. */
export function withOption(spec: KeySpec, o: Obj, v: unknown): Obj | undefined {
  const opts: Obj = { ...(isObj(spec.options) ? spec.options : {}) };
  const name = String(o.name);
  if (v === null || v === undefined || (v === "" && o.default !== "") || JSON.stringify(v) === JSON.stringify(o.default)) Reflect.deleteProperty(opts, name);
  else opts[name] = v;
  return Object.keys(opts).length ? opts : undefined;
}

const expandKey = (spec: KeySpec) => ({ widget: spec.widget, size: spec.size, options: spec.options ?? null, colors: spec.colors ?? null });

export function useWidgetOps(page: string) {
  const t = useT();
  const schema = useSchema().data;
  const edit = useConfig((s) => s.edit);
  const go = useUi((s) => s.go);
  const placed = placedToastFor(t, schema);
  const widgets = () => (useConfig.getState().cfg?.widgets as Obj | undefined) ?? null;
  const expand = (spec: KeySpec) => api("POST /api/widget/expand", { key: expandKey(spec), widgets: widgets(), id: null });

  const setSize = (anchor: string, size: string) => {
    const [cols, rows] = sizeColsRows(size);
    const cells = footprint(anchor, cols, rows);
    if (!cells) return;
    let removed: Removed[] = [];
    edit((d) => {
      const keys = draftKeys(d, page);
      removed = clearKeys(keys, cells, anchor);
      const s = keys[anchor];
      if (s) s.size = size;
    });
    go({ key: anchor, tab: "look" });
    if (removed.length) placed(t("Size changed to {0}.", [size.replace("x", "×")]), removed);
  };

  /** Muda uma opção; se o modelo tem ações padrão, elas seguem a opção (menos as que a pessoa mudou). */
  const setOption = async (anchor: string, o: Obj, v: unknown) => {
    const before = pageKeysOf(useConfig.getState().cfg, page)[anchor];
    if (!before) return;
    const d = widgetDefs(schema, useConfig.getState().cfg)[String(before.widget)];
    const after: KeySpec = { ...before };
    const opts = withOption(before, o, v);
    if (opts) after.options = opts;
    else Reflect.deleteProperty(after, "options");
    const patch: Obj = {};
    if (d && (d.action || d.hold)) {
      try {
        const [was, now] = await Promise.all([expand(before), expand(after)]);
        for (const m of ["action", "hold"] as const) {
          if (now[m] && JSON.stringify(before[m]) === JSON.stringify(was[m])) patch[m] = now[m];
        }
      } catch {
        /* sem servidor: a ação fica como estava */
      }
    }
    edit((dr) => {
      const s = draftKeys(dr, page)[anchor];
      if (!s) return;
      if (opts) s.options = opts;
      else Reflect.deleteProperty(s, "options");
      Object.assign(s, patch);
    }, `opt:${page}:${anchor}:${String(o.name)}`);
  };

  const setColors = (anchor: string, colors: Obj | null, tag?: string) =>
    edit((d) => {
      const s = draftKeys(d, page)[anchor];
      if (!s) return;
      if (colors) s.colors = colors;
      else Reflect.deleteProperty(s, "colors");
    }, tag);

  /** O que transforma o widget em bloco comum (ou tecla comum, se 1×1) com o desenho de agora; null se falhou. */
  const detachPatch = async (spec: KeySpec): Promise<((s: KeySpec) => void) | null> => {
    let built: Awaited<ReturnType<typeof expand>>;
    try {
      built = await expand(spec);
    } catch (e) {
      toast(t("Couldn't separate the widget: ") + (e as Error).message, { bad: true });
      return null;
    }
    const label = labelOf(String(spec.widget));
    return (s: KeySpec) => {
      for (const f of ["widget", "size", "options", "colors"]) Reflect.deleteProperty(s, f);
      if (built.span[0] * built.span[1] > 1) Object.assign(s, { span: built.span, cells: clone(built.cells), mode: "split", icon: { text: label } });
      else s.icon = clone(built.cells[0] ?? {});
    };
  };
  const labelOf = (id: string) => String(widgetDefs(schema, useConfig.getState().cfg)[id]?.label ?? id);

  /** "Editar tecla por tecla": o widget vira bloco comum. */
  const detach = async (anchor: string) => {
    const spec = pageKeysOf(useConfig.getState().cfg, page)[anchor];
    if (!spec?.widget) return;
    const label = labelOf(String(spec.widget));
    const apply = await detachPatch(spec);
    if (!apply) return;
    edit((d) => {
      const s = draftKeys(d, page)[anchor];
      if (s) apply(s);
    });
    go({ key: anchor, tab: "look" });
    toast(t("{0} is now a regular block. Each key can be changed on its own.", [label]), { undo: undoButton(t) });
  };

  /** Apaga um dos meus widgets; as teclas que o usam viram blocos comuns. Tudo num passo só do desfazer. */
  const removeMine = async (id: string) => {
    const cfg = useConfig.getState().cfg;
    const label = labelOf(id);
    const used: [string, string, (s: KeySpec) => void][] = [];
    for (const [p, keys] of Object.entries(pagesOf(cfg))) {
      for (const [k, spec] of Object.entries(keys)) {
        if (spec?.widget !== id) continue;
        const apply = await detachPatch(spec);
        if (!apply) return;
        used.push([p, k, apply]);
      }
    }
    edit((d) => {
      for (const [p, k, apply] of used) {
        const s = draftKeys(d, p)[k];
        if (s) apply(s);
      }
      const w = d.widgets as Obj | undefined;
      if (!w) return;
      Reflect.deleteProperty(w, id);
      if (!Object.keys(w).length) delete d.widgets;
    });
    toast(used.length ? t("{0} deleted. The {1} keys that used it became regular blocks.", [label, used.length]) : t("{0} deleted.", [label]), { undo: undoButton(t) });
  };

  return { setSize, setOption, setColors, detach, removeMine };
}
