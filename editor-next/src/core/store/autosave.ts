// Gravação automática: 900 ms depois da última mudança, manda o config inteiro para POST /api/config
// (o servidor valida e só grava se estiver tudo certo). Igual ao editor atual, menos a cópia de segurança no
// localStorage: a chave "d6-pendente" é do editor atual (mesma origem) e não pode ser misturada.
import { api, ApiError } from "@/core/api";
import { isDirty, useConfig, type Config } from "@/core/store/config";

export const SAVE_DELAY_MS = 900;

type Post = (config: Config) => Promise<{ ok: true } | { ok: false; errors: string[] }>;

const defaultPost: Post = (config) => api("POST /api/config", { config });

let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<boolean> | null = null;

/** Grava agora (se houver mudança). Devolve se ficou tudo salvo. */
export async function flushSave(post: Post = defaultPost): Promise<boolean> {
  clearTimeout(timer);
  if (inFlight) await inFlight;
  const state = useConfig.getState();
  if (!isDirty(state) || state.cfg === null) {
    useConfig.setState({ saveState: "saved" });
    return true;
  }
  const sent = JSON.stringify(state.cfg);
  useConfig.setState({ saveState: "saving" });
  inFlight = (async () => {
    try {
      const r = await post(JSON.parse(sent) as Config);
      if (!r.ok) {
        useConfig.setState({ saveState: "error", errors: r.errors });
        return false;
      }
      useConfig.setState({ saved: sent, errors: [] });
      const dirty = isDirty(useConfig.getState());
      useConfig.setState({ saveState: dirty ? "pending" : "saved" });
      if (dirty) schedule(post);
      return true;
    } catch (e) {
      useConfig.setState({ saveState: "error", tokenExpired: e instanceof ApiError && e.code === "token" });
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function schedule(post: Post): void {
  clearTimeout(timer);
  timer = setTimeout(() => void flushSave(post), SAVE_DELAY_MS);
}

/** Liga a gravação automática; devolve a função que desliga. */
export function startAutosave(post: Post = defaultPost): () => void {
  const unsubscribe = useConfig.subscribe((s, prev) => {
    if (s.cfg === prev.cfg || s.cfg === null) return;
    if (prev.cfg === null) return; // carregou: não é edição
    if (isDirty(s)) {
      if (s.saveState !== "saving") useConfig.setState({ saveState: "pending" });
      schedule(post);
    } else if (!inFlight) {
      useConfig.setState({ saveState: "saved" }); // voltou a ser igual ao salvo (ex.: desfez)
      clearTimeout(timer);
    }
  });
  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
