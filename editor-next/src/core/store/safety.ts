// Rede de segurança da gravação (como no editor atual, com chave própria: "d6-pendente" é do editor atual):
// - o que ainda não foi salvo fica guardado neste navegador; ao abrir, se sobrou algo diferente do que o app tem,
//   o aviso oferece "Recuperar";
// - fechando a aba com algo pendente, manda salvar mesmo assim (keepalive sobrevive ao fechamento);
// - salvar falhou: o app reiniciou (token novo) pede recarregar; outro erro diz qual.
import { t } from "@/core/i18n";
import { isDirty, useConfig, type Config } from "@/core/store/config";
import { readToken } from "@/core/token";
import { toast } from "@/core/toast";
import { RefreshCw, RotateCcw } from "lucide-react";

export const PENDING_KEY = "deck-next-pendente";

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // sem storage (modo privado, bloqueado)
  }
}
const keep = (cfg: Config) => {
  try {
    store()?.setItem(PENDING_KEY, JSON.stringify({ cfg, t: Date.now() }));
  } catch {
    /* cheio ou bloqueado */
  }
};
const drop = () => {
  try {
    store()?.removeItem(PENDING_KEY);
  } catch {
    /* sem storage */
  }
};

function read(): { cfg?: Config; t?: number } | null {
  try {
    return JSON.parse(store()?.getItem(PENDING_KEY) ?? "null") as { cfg?: Config; t?: number } | null;
  } catch {
    return null;
  }
}

/** Ao abrir: sobrou de antes algo que não foi salvo? Oferece recuperar. */
export function offerPending(lang: string): void {
  const p = read();
  const saved = useConfig.getState().saved;
  if (!p?.cfg || JSON.stringify(p.cfg) === saved) return drop();
  const cfg = p.cfg;
  const when = new Date(p.t ?? Date.now()).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  toast(t("There are changes from {0} that were not saved.", [when]), {
    sticky: true,
    action: {
      label: t("Recover"),
      icon: RotateCcw,
      // entra como uma edição: dá para desfazer e grava sozinha
      run: () =>
        useConfig.getState().edit((d) => {
          for (const k of Object.keys(d)) Reflect.deleteProperty(d, k);
          Object.assign(d, structuredClone(cfg));
        }),
    },
  });
}

/** Liga a rede de segurança; devolve a função que desliga. */
export function startSafety(): () => void {
  let warned = false;
  const unsub = useConfig.subscribe((s, prev) => {
    if (s.cfg !== prev.cfg && s.cfg) {
      if (isDirty(s)) keep(s.cfg);
      else drop();
    }
    if (s.saved !== prev.saved && !isDirty(s)) drop();
    // salvar falhou por exceção (não por config inválido: esse vai para o painel de problemas)
    if (s.saveState === "error" && prev.saveState !== "error" && !s.errors.length) {
      if (s.tokenExpired) {
        if (warned) return;
        warned = true;
        toast(t("The app restarted and this tab is out of date. Reload the page: anything not saved will be recovered."), {
          bad: true,
          sticky: true,
          action: { label: t("Reload"), icon: RefreshCw, run: () => location.reload() },
        });
      } else toast(t("Error saving: ") + (s.saveError ?? ""), { bad: true });
    }
  });
  const onHide = () => {
    const s = useConfig.getState();
    if (!s.cfg || !isDirty(s)) return;
    void fetch("/api/config", {
      method: "POST",
      keepalive: true,
      headers: { "X-Token": readToken() ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ config: s.cfg }),
    }).catch(() => {});
  };
  window.addEventListener("pagehide", onHide);
  return () => {
    unsub();
    window.removeEventListener("pagehide", onHide);
  };
}
