// Juntar teclas à mão (o toggleMulti, multiRect e joinKeys do editor atual): Shift+clique escolhe várias; se
// formam um retângulo sem buracos (e sem bloco nem widget no meio), viram um bloco "distribuído" com o desenho de
// cada uma. A ação da tecla do canto (ou da primeira que tiver uma) fica para o bloco.
import { create } from "zustand";
import { clone, normalizeIcon, type Obj } from "@/core/obj";
import { useConfig, type Config } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { MOMENTS, clearKeys } from "@/features/keys/actions";
import { draftKeys } from "@/features/keys/keys";
import { coverMap, footprint, kat, kpos, pageKeysOf, spanOf, type KeySpec, type PageKeys } from "@/features/keys/model";
import type { Removed } from "@/features/keys/actions";

type T = (s: string, a?: unknown[]) => string;

export const useMulti = create<{ keys: string[] }>()(() => ({ keys: [] }));

export function toggleMulti(k: string) {
  useMulti.setState((s) => ({ keys: s.keys.includes(k) ? s.keys.filter((x) => x !== k) : [...s.keys, k] }));
}
export const clearMulti = () => useMulti.setState({ keys: [] });

/** O retângulo que as escolhidas formam, ou null (buraco, bloco ou widget no meio, menos de duas). */
export function multiRect(keys: PageKeys, sel: string[]): { anchor: string; cols: number; rows: number } | null {
  if (sel.length < 2) return null;
  const ps = sel.map(kpos);
  const c0 = Math.min(...ps.map((p) => p[0])),
    c1 = Math.max(...ps.map((p) => p[0]));
  const r0 = Math.min(...ps.map((p) => p[1])),
    r1 = Math.max(...ps.map((p) => p[1]));
  const cols = c1 - c0 + 1,
    rows = r1 - r0 + 1;
  if (cols * rows !== sel.length) return null; // tem buraco: não é um retângulo
  const cov = coverMap(keys);
  const busy = (k: string) => {
    const s = keys[k];
    const [bc, br] = spanOf(s);
    return !!cov[k] || !!(s as Obj | undefined)?.widget || bc * br > 1;
  };
  if (sel.some(busy)) return null; // já tem bloco ou widget no meio
  return { anchor: kat(c0, r0), cols, rows };
}

/** Junta as escolhidas num bloco. Devolve as teclas substituídas (para o aviso com "guardar as substituídas"). */
export function joinKeys(t: T, page: string): { size: string; removed: Removed[] } | null {
  const cfg: Config | null = useConfig.getState().cfg;
  const rect = multiRect(pageKeysOf(cfg, page), useMulti.getState().keys);
  if (!rect) return null;
  let removed: Removed[] = [];
  useConfig.getState().edit((d) => {
    const keys = draftKeys(d, page);
    const list = footprint(rect.anchor, rect.cols, rect.rows) ?? [];
    const cells = list.map((k) => (keys[k] ? normalizeIcon(keys[k]?.icon) : {}));
    const withAction = list.find((k) => keys[k] && (keys[k]?.action || keys[k]?.hold));
    const base: KeySpec = keys[rect.anchor] ? clone(keys[rect.anchor] as KeySpec) : {};
    const donor = withAction ? clone(keys[withAction] as KeySpec) : null;
    removed = clearKeys(
      keys,
      list.filter((k) => k !== rect.anchor),
    ).filter((r) => r.key !== withAction);
    const spec: KeySpec = { ...base, span: [rect.cols, rect.rows], cells, mode: "split", icon: { text: normalizeIcon(base.icon).text || t("Block") } };
    if (donor && withAction !== rect.anchor) for (const m of MOMENTS) if (donor[m] && !spec[m]) spec[m] = clone(donor[m]);
    keys[rect.anchor] = spec;
  });
  clearMulti();
  useUi.getState().go({ key: rect.anchor, tab: "look", lookMode: "normal" });
  return { size: `${rect.rows}×${rect.cols}`, removed };
}
