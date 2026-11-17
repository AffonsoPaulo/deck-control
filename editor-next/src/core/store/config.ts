// O config em edição, com desfazer/refazer e gravação automática (como no editor atual).
//
// Desfazer guarda a VERSÃO ANTERIOR INTEIRA (não patches do immer): o immer reaproveita as partes que não
// mudaram, então cada versão custa só o que mudou, e desfazer devolve o objeto de antes tal como era (inclusive
// a ordem das chaves: desfazer a exclusão de uma página a põe de volta no lugar, não no fim).
// Um gesto (arrastar, digitar num campo) vira uma entrada só: edições com a mesma `tag` em menos de 350 ms se juntam.
// Seleção, aba aberta e prévias não ficam aqui (store de UI): não entram no histórico.
import { produce, type Draft } from "immer";
import { create } from "zustand";
/** O config como objeto JSON (aberto: o modelo tipado chega com a Fase 4 do Python). */
export type Config = Record<string, unknown>;
export type SaveState = "saved" | "pending" | "saving" | "error";

export const HISTORY_LIMIT = 200;
export const MERGE_MS = 350;

export interface ConfigStore {
  cfg: Config | null;
  /** JSON do que está gravado no servidor (para saber se há mudança não salva). */
  saved: string;
  past: Config[];
  future: Config[];
  lastTag: string | null;
  lastAt: number;
  saveState: SaveState;
  /** Problemas que impediram a última gravação (texto para a pessoa). */
  errors: string[];
  /** O app reiniciou e esta aba ficou com o token velho: só recarregando. */
  tokenExpired: boolean;
  /** A mensagem do último erro de gravação que não foi config inválido (rede, app fechado). */
  saveError: string | null;
  /** A versão do arquivo em que esta edição se baseia (vai junto ao salvar; null = grava sem conferir). */
  rev: string | null;
  /** O arquivo mudou em outro lugar (outra aba, histórico, edição à mão): nada mais grava até recarregar. */
  conflict: boolean;

  load: (cfg: Config, rev?: string | null) => void;
  edit: (recipe: (draft: Draft<Config>) => void, tag?: string) => void;
  undo: () => void;
  redo: () => void;
}

export const isDirty = (s: Pick<ConfigStore, "cfg" | "saved">): boolean =>
  s.cfg !== null && JSON.stringify(s.cfg) !== s.saved;

export const useConfig = create<ConfigStore>()((set, get) => ({
  cfg: null,
  saved: "",
  past: [],
  future: [],
  lastTag: null,
  lastAt: 0,
  saveState: "saved",
  errors: [],
  tokenExpired: false,
  saveError: null,
  rev: null,
  conflict: false,

  load: (cfg, rev = null) =>
    set({ cfg, saved: JSON.stringify(cfg), past: [], future: [], lastTag: null, lastAt: 0, saveState: "saved", errors: [], rev, conflict: false }),

  edit: (recipe, tag) => {
    const { cfg, past, lastTag, lastAt } = get();
    if (cfg === null) return;
    const next = produce(cfg, recipe);
    if (next === cfg) return; // nada mudou: não vira entrada no histórico
    const now = Date.now();
    const merge = tag !== undefined && tag === lastTag && now - lastAt < MERGE_MS && past.length > 0;
    const nextPast = merge ? past : [...past, cfg].slice(-HISTORY_LIMIT);
    set({ cfg: next, past: nextPast, future: [], lastTag: tag ?? null, lastAt: now });
  },

  undo: () => {
    const { cfg, past, future } = get();
    const prev = past[past.length - 1];
    if (cfg === null || prev === undefined) return;
    set({ cfg: prev, past: past.slice(0, -1), future: [cfg, ...future], lastTag: null });
  },

  redo: () => {
    const { cfg, past, future } = get();
    const next = future[0];
    if (cfg === null || next === undefined) return;
    set({ cfg: next, past: [...past, cfg], future: future.slice(1), lastTag: null });
  },
}));
