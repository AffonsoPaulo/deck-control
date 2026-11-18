// O que vale só nesta aba e nunca vai para o config nem para a URL: a tecla copiada, o ícone/imagem de antes de
// trocar o que vai no centro da tecla (para voltar sem perder) e se "Tamanhos" está aberto.
import { create } from "zustand";
import type { KeySpec } from "@/features/keys/model";

export interface LookMemory {
  icon?: { lucide: unknown; glyph: unknown };
  image?: unknown;
  fill?: unknown;
}

interface Session {
  clipboard: KeySpec | null;
  sizesOpen: boolean | null; // null = abre sozinho se a tecla tem tamanho ajustado
  lookMem: Record<string, LookMemory>; // "página:tecla"
  ruleOpen: string | null; // a regra aberta para editar ("página:tecla:índice")
  cellIdx: number; // a tecla do bloco em edição
  setRuleOpen: (id: string | null) => void;
  setCellIdx: (i: number) => void;
  setClipboard: (spec: KeySpec | null) => void;
  setSizesOpen: (open: boolean) => void;
  remember: (id: string, patch: LookMemory) => void;
}

export const useSession = create<Session>()((set) => ({
  clipboard: null,
  sizesOpen: null,
  lookMem: {},
  ruleOpen: null,
  cellIdx: 0,
  setRuleOpen: (ruleOpen) => set({ ruleOpen }),
  setCellIdx: (cellIdx) => set({ cellIdx }),
  setClipboard: (clipboard) => set({ clipboard }),
  setSizesOpen: (sizesOpen) => set({ sizesOpen }),
  remember: (id, patch) => set((s) => ({ lookMem: { ...s.lookMem, [id]: { ...s.lookMem[id], ...patch } } })),
}));
