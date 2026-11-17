// Onde a pessoa está, no endereço, com nomes que dá para ler:
//   /next/K7QM-2XPA-9DFT/teclas/main/4/aparencia
//   /next/K7QM-2XPA-9DFT/teclas/main/4/aparencia/ativa      (aparência de ligada)
//   /next/K7QM-2XPA-9DFT/teclas/main/4/luz/segurar          (luz ao segurar)
//   /next/K7QM-2XPA-9DFT/teclas/main/4/o-que-faz/ampliado   (lógica na área grande)
//   /next/K7QM-2XPA-9DFT/teclas/main?vista=ativas           (o Deck mostrando as teclas ligadas)
//   /next/K7QM-2XPA-9DFT/luz | /automacoes | /logs | /config/integracoes
// O token é o primeiro pedaço (XXXX-XXXX-XXXX); o servidor entrega a página para qualquer caminho atrás dele.
// O prefixo (/next/) é o base do Vite: quando o editor novo virar o principal, some sem mudar nada aqui.
import { DEFAULT_PLACE, SET_SECTIONS, type Place, type Section, type SetSection } from "@/core/hash";

export const TOKEN_RE = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){2}$/;

const SECTION_SLUG: Record<Section, string> = { keys: "teclas", light: "luz", auto: "automacoes", logs: "logs", settings: "config" };
const SET_SLUG: Record<SetSection, string> = {
  general: "geral",
  look: "aparencia",
  integrations: "integracoes",
  advanced: "avancado",
  backup: "backup",
  about: "sobre",
};
const TAB_SLUG: Record<Place["tab"], string> = { do: "o-que-faz", look: "aparencia", light: "luz" };
const MOMENT_SLUG: Record<Place["lightMoment"], string> = { press: "apertar", hold: "segurar", release: "soltar" };

const invert = <K extends string>(o: Record<K, string>): Record<string, K> => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k])) as Record<string, K>;
const SECTION_OF = invert(SECTION_SLUG);
const SET_OF = invert(SET_SLUG);
const TAB_OF = invert(TAB_SLUG);
const MOMENT_OF = invert(MOMENT_SLUG);
const KEYS = Array.from({ length: 15 }, (_, i) => String(i + 1));

/** O prefixo do editor no endereço ("/next/"), o mesmo base do build. */
export const basePath = (): string => (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Os pedaços do caminho depois do prefixo (já decodificados). */
function segments(pathname: string): string[] {
  const base = basePath();
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, "");
  return rest.split("/").filter(Boolean).map(decode);
}

/** O token que está no caminho (o primeiro pedaço), ou null. */
export function tokenFromPath(pathname: string): string | null {
  const first = segments(pathname)[0] ?? "";
  return TOKEN_RE.test(first) ? first : null;
}

/** Lê o lugar do endereço (o que não se entende fica no padrão). */
export function parseRoute(pathname: string, search = ""): Place {
  const p: Place = { ...DEFAULT_PLACE };
  const seg = segments(pathname);
  if (seg[0] && TOKEN_RE.test(seg[0])) seg.shift();
  const section = SECTION_OF[seg[0] ?? ""];
  if (section) p.section = section;
  if (new URLSearchParams(search).get("vista") === "ativas") p.view = "active";
  if (p.section === "settings") {
    const sub = SET_OF[seg[1] ?? ""];
    if (sub && (SET_SECTIONS as readonly string[]).includes(sub)) p.setSection = sub;
    return p;
  }
  if (p.section !== "keys") return p;
  p.page = seg[1] ?? null;
  const key = seg[2];
  if (!key || !KEYS.includes(key)) return p;
  p.key = key;
  const tab = TAB_OF[seg[3] ?? ""];
  if (tab) p.tab = tab;
  const extra = seg[4];
  if (p.tab === "look" && extra === "ativa") p.lookMode = "active";
  if (p.tab === "light") {
    const m = MOMENT_OF[extra ?? ""];
    if (m) p.lightMoment = m;
  }
  if (p.tab === "do" && extra === "ampliado") p.expanded = true;
  return p;
}

/** Escreve o endereço do lugar (com o token na frente). */
export function formatRoute(p: Place, token: string): string {
  const seg: string[] = [token, SECTION_SLUG[p.section]];
  let search = "";
  if (p.section === "settings" && p.setSection !== "general") seg.push(SET_SLUG[p.setSection]);
  if (p.section === "keys") {
    if (p.page) {
      seg.push(p.page);
      if (p.key) {
        seg.push(p.key);
        if (p.tab === "look") seg.push(TAB_SLUG.look, ...(p.lookMode === "active" ? ["ativa"] : []));
        else if (p.tab === "light") seg.push(TAB_SLUG.light, ...(p.lightMoment !== "press" ? [MOMENT_SLUG[p.lightMoment]] : []));
        else if (p.expanded) seg.push(TAB_SLUG.do, "ampliado");
      }
    }
    if (p.view === "active") search = "?vista=ativas";
  }
  return basePath() + seg.map(encodeURIComponent).join("/") + search;
}
