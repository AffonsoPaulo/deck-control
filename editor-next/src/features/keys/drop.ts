// O que acontece enquanto uma peça anda e quando ela cai na grade: acende as casas onde ela cairia (âmbar; as
// ocupadas com "substitui"; a que passa da borda em vermelho) e, ao soltar, troca as teclas ou coloca a peça.
// Mesmas regras do pieceOver/pieceDrop do editor atual. Lê o estado na hora (o dnd-kit guarda a primeira versão).
import { useT } from "@/core/i18n";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { footprintAt } from "@/features/keys/actions";
import { NO_FOOT, useDeckState, type Foot } from "@/features/keys/deckState";
import type { DragPoint } from "@/features/keys/dnd";
import { cellAt, coverMap, dropAnchor, pageKeysOf, pieceSize, resolveDrop, selectionAfterSwap, swapKeys, type DragPayload, type PageKeys } from "@/features/keys/model";
import { usePlacer } from "@/features/keys/place";
import { draftKeys } from "@/features/keys/keys";

/** A casa debaixo do ponto, dentro da tecla (ou do bloco) `target`. */
function cellUnder(target: string, keys: PageKeys, x: number, y: number): string {
  const el = useDeckState.getState().grid?.querySelector<HTMLElement>(`[data-key="${target}"]`);
  return el ? cellAt(target, keys[target], el.getBoundingClientRect(), x, y) : target;
}

/** As marcas de uma peça cols×rows que cairia em `anchor` (as casas viram a tecla de cada uma: o canto, num bloco). */
export function footFor(keys: PageKeys, anchor: string, cols: number, rows: number, label: string, t: ReturnType<typeof useT>): Foot {
  const fp = footprintAt(keys, anchor, cols, rows);
  if (!fp.ok) return { ...NO_FOOT, bad: anchor };
  const cov = coverMap(keys);
  const el = (k: string) => (keys[k] ? k : (cov[k]?.[0] ?? k));
  const busy = new Set(fp.replace.map(el));
  const free = new Set(fp.cells.map(el).filter((k) => !busy.has(k)));
  const n = fp.replace.length; // como no atual: conta as casas ocupadas
  const size = `${rows}×${cols}`;
  const tip =
    cols * rows > 1 || n
      ? (label ? `${label} ${size}` : size) + (n ? ": " + (n === 1 ? t("replaces 1 key") : t("replaces {0} keys", [n])) : "")
      : null;
  return { cells: [...free], replace: [...busy], bad: null, tip };
}

/** Quem cuida do que cai numa lista de passos (a aba "O que faz" registra quando está aberta). */
export const logicDrop: { current: ((payload: DragPayload, target: string) => void | Promise<void>) | null } = { current: null };

export function useDeckDrop(page: string) {
  const t = useT();
  const placer = usePlacer(page);

  const onMove = (p: DragPoint) => {
    const set = (foot: Foot) => useDeckState.setState({ foot });
    if (p.payload.kind === "key" || p.payload.kind === "step" || p.target === null || p.target.startsWith("slot|")) return set(NO_FOOT);
    const keys = pageKeysOf(useConfig.getState().cfg, page);
    const [cols, rows] = pieceSize(p.payload);
    const anchor = dropAnchor(p.payload, p.target, cellUnder(p.target, keys, p.x, p.y));
    set(footFor(keys, anchor, cols, rows, p.payload.label, t));
  };

  const onDrop = (p: DragPoint) => {
    useDeckState.setState({ foot: NO_FOOT });
    if (p.target === null) return;
    // soltou numa lista de passos de "O que faz"
    if (p.target.startsWith("slot|")) return void logicDrop.current?.(p.payload, p.target);
    if (p.payload.kind === "step") return;
    const keys = pageKeysOf(useConfig.getState().cfg, page);
    const r = resolveDrop(p.payload, p.target, cellUnder(p.target, keys, p.x, p.y), keys);
    if (r.op === "swap") {
      useConfig.getState().edit((d) => swapKeys(draftKeys(d, page), r.a, r.b));
      useUi.getState().go({ key: selectionAfterSwap(useUi.getState().key, r.a, r.b) });
      return;
    }
    placer.run(r);
  };

  return { onMove, onDrop };
}
