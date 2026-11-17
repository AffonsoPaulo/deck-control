// Onde a pessoa está (seção, página, tecla, aba): fora do histórico de desfazer, espelhado na URL.
import { create } from "zustand";
import { DEFAULT_PLACE, formatPlace, parsePlace, type Place } from "@/core/hash";
import { readToken } from "@/core/token";

export interface UiStore extends Place {
  go: (patch: Partial<Place>) => void;
}

export const useUi = create<UiStore>()((set) => ({
  ...(typeof window === "undefined" ? DEFAULT_PLACE : parsePlace(window.location.hash)),
  go: (patch) => set(patch),
}));

/** Mantém a URL igual ao lugar (sem criar entrada no histórico do navegador). */
export function startHashSync(): () => void {
  const token = readToken();
  if (!token) return () => {};
  const write = (p: Place) => {
    const hash = formatPlace(p, token);
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  };
  write(useUi.getState());
  return useUi.subscribe(write);
}
