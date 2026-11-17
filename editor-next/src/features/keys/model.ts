// A grade do Deck como dados (sem React): as 15 teclas em 5×3, os blocos de várias teclas (widget ou span), o que
// vai para o servidor desenhar as prévias e o que acontece quando algo é solto numa casa. Mesmas regras do editor
// atual (info.js: kpos/kat/spanOf/coverMap/footprint; app.js: swapKeys, a página inicial e updatePreviews).
import type { PreviewRequest } from "@/core/api-types";
import type { Config } from "@/core/store/config";

export const COLS = 5;
export const ROWS = 3;
export const KEYS: readonly string[] = Array.from({ length: COLS * ROWS }, (_, i) => String(i + 1));

export type KeySpec = Record<string, unknown>;
export type PageKeys = Record<string, KeySpec>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Coluna e linha da tecla ("1" = canto de cima à esquerda). */
export const kpos = (k: string): [number, number] => [(Number(k) - 1) % COLS, Math.floor((Number(k) - 1) / COLS)];
/** A tecla de uma coluna e linha. */
export const kat = (c: number, r: number): string => String(r * COLS + c + 1);

/** "2x3" = 2 linhas, 3 colunas. */
export const sizeRC = (size: unknown): [number, number] => {
  const [r, c] = String(size || "1x1")
    .split("x")
    .map(Number);
  return [r || 1, c || 1];
};

/** Quantas colunas e linhas a tecla ocupa (widget pelo tamanho; senão o span; senão 1×1). */
export function spanOf(spec: unknown): [number, number] {
  if (!isObj(spec)) return [1, 1];
  if (spec.widget) {
    const [r, c] = sizeRC(spec.size);
    return [c, r];
  }
  if (Array.isArray(spec.span)) return [Number(spec.span[0]) || 1, Number(spec.span[1]) || 1];
  return [1, 1];
}

/** As páginas do config (objeto vazio se não houver). */
export const pagesOf = (cfg: Config | null): Record<string, PageKeys> =>
  (isObj(cfg?.pages) ? cfg.pages : {}) as Record<string, PageKeys>;

/** As teclas de uma página (página vazia ou que não é objeto = sem teclas). */
export const pageKeysOf = (cfg: Config | null, page: string | null): PageKeys => {
  const p = page === null ? undefined : pagesOf(cfg)[page];
  return (isObj(p) ? p : {}) as PageKeys;
};

/** A página que abre: a da URL se existir; senão a inicial (home); senão a primeira. */
export function initialPage(cfg: Config | null, fromUrl: string | null): string | null {
  const pages = pagesOf(cfg);
  if (fromUrl !== null && pages[fromUrl]) return fromUrl;
  const home = cfg?.home;
  if (typeof home === "string" && pages[home]) return home;
  return Object.keys(pages)[0] ?? null;
}

/** Casa coberta por um bloco -> [tecla do canto do bloco, índice da casa dentro do bloco]. */
export function coverMap(keys: PageKeys): Record<string, [string, number]> {
  const out: Record<string, [string, number]> = {};
  for (const [k, spec] of Object.entries(keys)) {
    const [cols, rows] = spanOf(spec);
    if (cols === 1 && rows === 1) continue;
    const [c0, r0] = kpos(k);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const kk = kat(c0 + c, r0 + r);
        if (kk !== k) out[kk] = [k, i];
        i++;
      }
    }
  }
  return out;
}

/** Teclas que um pedaço cols×rows ocuparia a partir de `anchor` (null se sair da grade). */
export function footprint(anchor: string, cols: number, rows: number): string[] | null {
  const [c0, r0] = kpos(anchor);
  if (c0 < 0 || r0 < 0 || c0 + cols > COLS || r0 + rows > ROWS) return null;
  const out: string[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(kat(c0 + c, r0 + r));
  return out;
}

/** A casa do bloco `k` debaixo de um ponto, dado o retângulo do bloco na tela. */
export function cellAt(k: string, spec: unknown, rect: { left: number; top: number; width: number; height: number }, x: number, y: number): string {
  const [cols, rows] = spanOf(spec);
  if (cols * rows === 1) return k;
  const c = Math.max(0, Math.min(cols - 1, Math.floor((x - rect.left) / (rect.width / cols))));
  const r = Math.max(0, Math.min(rows - 1, Math.floor((y - rect.top) / (rect.height / rows))));
  const [c0, r0] = kpos(k);
  return kat(c0 + c, r0 + r);
}

// ---------------------------------------------------------------------------- o que se arrasta e onde cai

/** O que está sendo arrastado: uma tecla da grade, uma ação da biblioteca, um widget num tamanho ou uma tecla
 * guardada. `cols`/`rows`: quantas casas a peça ocupa (1×1 para tecla e ação). */
export type DragPayload =
  | { kind: "key"; key: string }
  | { kind: "new"; type: string; label: string }
  | { kind: "widget"; widget: string; size: string; label: string; cols: number; rows: number }
  | { kind: "saved"; index: number; label: string; cols: number; rows: number };

export const pieceSize = (p: DragPayload): [number, number] => (p.kind === "widget" || p.kind === "saved" ? [p.cols, p.rows] : [1, 1]);

export type DropResult =
  | { op: "swap"; a: string; b: string }
  | { op: "assign"; key: string; type: string }
  | { op: "widget"; anchor: string; widget: string; size: string }
  | { op: "saved"; anchor: string; index: number }
  | { op: "none" };

/** Onde a peça encaixa: peça de uma casa vale a tecla (o canto, num bloco); peça maior vale a casa sob o
 * ponteiro (a peça começa ali). */
export function dropAnchor(payload: DragPayload, target: string, cell: string): string {
  const [cols, rows] = pieceSize(payload);
  return cols * rows > 1 ? cell : target;
}

/** O que soltar `payload` na tecla `target` (casa `cell` sob o ponteiro) faz, sem mexer em nada. */
export function resolveDrop(payload: DragPayload, target: string, cell: string, keys: PageKeys): DropResult {
  const anchor = dropAnchor(payload, target, cell);
  switch (payload.kind) {
    case "key": {
      // solta em cima de uma casa de bloco: vale o canto do bloco
      const b = coverMap(keys)[target]?.[0] ?? target;
      if (b === payload.key || !keys[payload.key]) return { op: "none" };
      return { op: "swap", a: payload.key, b };
    }
    case "new":
      return { op: "assign", key: anchor, type: payload.type };
    case "widget":
      return { op: "widget", anchor, widget: payload.widget, size: payload.size };
    case "saved":
      return { op: "saved", anchor, index: payload.index };
  }
}

/** Troca duas teclas de lugar no rascunho (a vazia vai junto: some de onde estava). */
export function swapKeys(keys: PageKeys, a: string, b: string): void {
  if (a === b) return;
  const va = keys[a];
  const vb = keys[b];
  // a tecla é o nome do campo ("1".."15"): apagar o campo é tirar a tecla da página
  if (vb === undefined) Reflect.deleteProperty(keys, a);
  else keys[a] = vb;
  if (va === undefined) Reflect.deleteProperty(keys, b);
  else keys[b] = va;
}

/** A tecla selecionada depois da troca (a seleção acompanha a tecla). */
export const selectionAfterSwap = (sel: string | null, a: string, b: string): string | null =>
  sel === a ? b : sel === b ? a : sel;

// ---------------------------------------------------------------------------- prévias

const normalizeIcon = (v: unknown): Record<string, unknown> => (typeof v === "string" ? { text: v } : isObj(v) ? v : {});

/** O pedido de prévias de uma página: uma entrada por tecla (null = vazia), como no updatePreviews do atual. */
export function previewRequest(cfg: Config | null, page: string | null): PreviewRequest {
  const keys = pageKeysOf(cfg, page);
  const list = KEYS.map((k) => {
    const s = keys[k];
    if (!isObj(s)) return null;
    return {
      icon: normalizeIcon(s.icon),
      active_icon: s.active_icon ? normalizeIcon(s.active_icon) : null,
      action: s.action ?? null,
      state: s.state || null,
      span: s.span || null,
      cells: s.cells || null,
      mode: s.mode || null,
      ...(s.widget ? { widget: s.widget, size: s.size, options: s.options || null, colors: s.colors || null } : {}),
    };
  });
  return {
    keys: list,
    icons: isObj(cfg?.icons) ? cfg.icons : null,
    device: isObj(cfg?.device) ? cfg.device : null,
    widgets: isObj(cfg?.widgets) ? cfg.widgets : null,
  };
}
