// Rede de segurança da gravação (como no editor atual, com chave própria: "d6-pendente" é do editor atual):
// - o que ainda não foi salvo fica guardado neste navegador, SEM as senhas (a do OBS e os campos "password" dos
//   plugins); ao abrir, se sobrou algo diferente do que o app tem, o aviso oferece "Recuperar", que mantém as
//   senhas de agora;
// - fechando a aba com algo pendente, manda salvar mesmo assim (keepalive sobrevive ao fechamento);
// - salvar falhou: o app reiniciou (token novo) pede recarregar; outro erro diz qual.
import type { EditorSchema } from "@/core/api-types";
import { t } from "@/core/i18n";
import { isObj, type Obj } from "@/core/obj";
import { queryClient } from "@/core/queries";
import { isDirty, useConfig, type Config } from "@/core/store/config";
import { readToken } from "@/core/token";
import { toast } from "@/core/toast";
import { RefreshCw, RotateCcw } from "lucide-react";

export const PENDING_KEY = "deck-next-pendente";

type Path = string[];

/** Onde ficam as senhas no config: a do OBS e os campos "password" que cada plugin declara. */
export function secretPaths(): Path[] {
  const out: Path[] = [["obs", "password"]];
  const schema = queryClient.getQueryData<EditorSchema>(["schema"]);
  for (const pl of (schema?.plugins ?? []) as Obj[]) {
    const base = Array.isArray(pl.config_path) ? (pl.config_path as string[]) : [String(pl.id)];
    for (const st of (Array.isArray(pl.settings) ? pl.settings : []) as Obj[]) if (st.kind === "password") out.push([...base, String(st.name)]);
  }
  return out;
}
const at = (o: unknown, path: Path): unknown => path.reduce<unknown>((n, k) => (isObj(n) ? n[k] : undefined), o);
function put(o: Obj, path: Path, v: unknown) {
  let n: Obj = o;
  for (const k of path.slice(0, -1)) {
    if (!isObj(n[k])) n[k] = {};
    n = n[k] as Obj;
  }
  const last = path[path.length - 1] as string;
  if (v === undefined) Reflect.deleteProperty(n, last);
  else n[last] = v;
}
/** O config sem as senhas (o que vai para o navegador). */
export function withoutSecrets(cfg: Config): Config {
  const c = structuredClone(cfg);
  for (const p of secretPaths()) if (at(c, p) !== undefined) put(c, p, undefined);
  return c;
}
/** O config recuperado com as senhas de agora (as que estão no app). */
export function withSecretsFrom(cfg: Config, now: Config | null): Config {
  const c = structuredClone(cfg);
  for (const p of secretPaths()) {
    const v = at(now, p);
    if (v !== undefined) put(c, p, v);
  }
  return c;
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // sem storage (modo privado, bloqueado)
  }
}
const keep = (cfg: Config) => {
  try {
    store()?.setItem(PENDING_KEY, JSON.stringify({ cfg: withoutSecrets(cfg), t: Date.now() }));
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
  const now = useConfig.getState().cfg;
  if (!p?.cfg || JSON.stringify(withSecretsFrom(p.cfg, now)) === saved) return drop();
  const cfg = p.cfg;
  const when = new Date(p.t ?? Date.now()).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  toast(t("There are changes from {0} that were not saved.", [when]), {
    sticky: true,
    action: {
      label: t("Recover"),
      icon: RotateCcw,
      // entra como uma edição: dá para desfazer e grava sozinha
      run: () => {
        const full = withSecretsFrom(cfg, useConfig.getState().cfg);
        useConfig.getState().edit((d) => {
          for (const k of Object.keys(d)) Reflect.deleteProperty(d, k);
          Object.assign(d, full);
        });
      },
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
    // o arquivo mudou em outro lugar: a edição daqui fica guardada (a cópia acima) e recarregar oferece recuperar
    if (s.conflict && !prev.conflict) {
      toast(t("The settings changed somewhere else (another tab, the history or the file). Reload to continue: what you changed here is kept so you can recover it."), {
        bad: true,
        sticky: true,
        action: { label: t("Reload"), icon: RefreshCw, run: () => location.reload() },
      });
      return;
    }
    // salvar falhou por exceção (não por config inválido: esse vai para o painel de problemas)
    if (s.saveState === "error" && prev.saveState !== "error" && !s.errors.length && !s.conflict) {
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
    if (!s.cfg || !isDirty(s) || s.conflict) return;
    void fetch("/api/config", {
      method: "POST",
      keepalive: true,
      headers: { "X-Token": readToken() ?? "", "Content-Type": "application/json" },
      // com a versão: se outra aba gravou depois, o servidor recusa em vez de apagar a mudança dela
      body: JSON.stringify(s.rev ? { config: s.cfg, rev: s.rev } : { config: s.cfg }),
    }).catch(() => {});
  };
  window.addEventListener("pagehide", onHide);
  return () => {
    unsub();
    window.removeEventListener("pagehide", onHide);
  };
}
