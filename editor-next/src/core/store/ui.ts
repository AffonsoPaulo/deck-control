// Onde a pessoa está (seção, página, tecla, aba): fora do histórico de desfazer, espelhado no endereço
// (/next/XXXX-XXXX-XXXX/teclas/main/4/aparencia; ver core/route.ts).
import { create } from "zustand";
import { DEFAULT_PLACE, parsePlace, type Place } from "@/core/hash";
import { TOKEN_RE, formatRoute, parseRoute } from "@/core/route";
import { readToken } from "@/core/token";

/** O lugar do endereço de agora (um link no formato antigo, #t=...&p=..., também vale). */
function placeFromLocation(): Place {
  const { hash, pathname, search } = window.location;
  if (new URLSearchParams(hash.replace(/^#/, "")).has("t")) return parsePlace(hash);
  return parseRoute(pathname, search);
}

export interface UiStore extends Place {
  go: (patch: Partial<Place>) => void;
}

export const useUi = create<UiStore>()((set) => ({
  ...(typeof window === "undefined" ? DEFAULT_PLACE : placeFromLocation()),
  go: (patch) => set(patch),
}));

/** Mantém o endereço igual ao lugar (sem criar entrada no histórico do navegador). O primeiro write já troca
 * um link no formato antigo pelo novo. */
export function startUrlSync(): () => void {
  const token = readToken();
  // token no formato antigo (comprido, de um servidor que ainda não reiniciou): o endereço novo não abriria
  // nesse servidor; fica o link como veio
  if (!token || !TOKEN_RE.test(token)) return () => {};
  const write = (p: Place) => {
    const url = formatRoute(p, token);
    const now = window.location.pathname + window.location.search + window.location.hash;
    if (now !== url) window.history.replaceState(null, "", url);
  };
  write(useUi.getState());
  return useUi.subscribe(write);
}
