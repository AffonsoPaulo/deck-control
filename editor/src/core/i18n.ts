// Idiomas do editor, com as MESMAS regras e o MESMO arquivo do editor atual (app/editor/static/locales/pt-BR.json):
// - o texto em inglês é a chave; sem tradução, sai o inglês;
// - "Mute##2" é a mesma palavra em inglês com outra tradução; o "##2" some na tela (só quando não há tradução);
// - variáveis por posição: t("Key {0}, page {1}", [3, "main"]); "{{" e "}}" viram "{" e "}".
// O i18next guarda os textos e avisa o React quando o idioma muda; a interpolação e o aninhamento dele ficam
// desligados (prefixos que nunca aparecem) e a regra acima roda num pós-processador.
import i18next, { type PostProcessorModule } from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import ptBR from "deck-static/locales/pt-BR.json";

export type Lang = "pt-BR" | "en";
export type TArgs = readonly unknown[];

const NEVER = "\u0000\u0001never\u0001\u0000";

const deckRules: PostProcessorModule = {
  type: "postProcessor",
  name: "deck",
  process(value: string, key: string | string[], options: { args?: TArgs }) {
    const k = Array.isArray(key) ? (key[0] ?? "") : key;
    let s = value === k ? (k.split("##")[0] ?? k) : value;
    const args = options.args;
    if (args) s = s.replace(/\{(\d+)\}/g, (_m, n: string) => (args[Number(n)] == null ? "" : String(args[Number(n)])));
    return s.replace(/\{\{/g, "{").replace(/\}\}/g, "}");
  },
};

/** O idioma de partida: o que o editor atual guardou (só lê; quem grava é ele) ou o do navegador. */
export function initialLang(): Lang {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem("d6-lang");
  } catch {
    /* sem storage */
  }
  if (saved === "en" || saved === "pt-BR") return saved;
  return (navigator.language || "").toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

export const i18n = i18next.createInstance();
void i18n
  .use(deckRules)
  .use(initReactI18next)
  .init({
    lng: typeof window === "undefined" ? "en" : initialLang(),
    fallbackLng: false,
    resources: { "pt-BR": { translation: ptBR as Record<string, string> }, en: { translation: {} } },
    keySeparator: false,
    nsSeparator: false,
    returnEmptyString: true,
    postProcess: ["deck"],
    interpolation: { escapeValue: false, prefix: NEVER, suffix: NEVER, nestingPrefix: NEVER, nestingSuffix: NEVER },
    initAsync: false,
    react: { useSuspense: false },
  });

/** Tradução fora de componente (o idioma atual). */
export function t(key: string, args?: TArgs): string {
  return i18n.t(key, args ? { args } : {}) as string;
}

/** Tradução dentro de componente: redesenha quando o idioma muda. */
export function useT(): typeof t {
  useTranslation(undefined, { i18n });
  return t;
}

export function normalizeLang(value: unknown): Lang | null {
  if (typeof value !== "string") return null;
  const s = value.replace("_", "-").toLowerCase();
  return s.startsWith("pt") ? "pt-BR" : s.startsWith("en") ? "en" : null;
}

export async function setLang(lang: Lang): Promise<void> {
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}
