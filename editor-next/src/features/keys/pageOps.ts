// Mexer nas páginas (o addPage, renamePage, deletePage e moveKeyToPage do editor antigo): criar já com o nome
// aberto para editar, renomear corrigindo o que citava a página (teclas, automações, páginas temporárias, luz por
// página; o antigo só corrigia as teclas), apagar (com desfazer) e levar uma tecla para outra página (cai no
// primeiro lugar livre onde ela cabe; um bloco precisa de todas as casas livres).
import { create } from "zustand";
import { isObj } from "@/core/obj";
import { useConfig, type Config } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { undoButton } from "@/core/store/undo";
import { toast } from "@/core/toast";
import { MOMENTS } from "@/features/keys/actions";
import { draftKeys } from "@/features/keys/keys";
import { coverMap, footprint, pagesOf, spanOf, type PageKeys } from "@/features/keys/model";

type T = (s: string, a?: unknown[]) => string;

const KEYS = Array.from({ length: 15 }, (_, i) => String(i + 1));

/** Qual aba está virando campo de texto (renomear). */
export const useRenaming = create<{ name: string | null }>()(() => ({ name: null }));

export function addPage(t: T) {
  const pages = pagesOf(useConfig.getState().cfg);
  let n = 1;
  let name = "";
  do {
    name = n === 1 ? t("new") : `${t("new")} ${n}`;
    n++;
  } while (pages[name]);
  useConfig.getState().edit((d) => {
    ((d.pages ??= {}) as Record<string, PageKeys>)[name] = {};
  });
  useUi.getState().go({ page: name, key: null });
  useRenaming.setState({ name }); // já abre o nome para editar
}

const PAGE_ACTIONS = new Set(["page", "page.temp"]); // as ações que levam a uma página pelo nome

/** O botão que levava para a página antiga passa a levar para a nova (em todos os momentos, dentro de listas). */
export function fixPageRefs(a: unknown, old: string, name: string): unknown {
  if (typeof a === "string") return a === `page:${old}` ? `page:${name}` : a;
  if (Array.isArray(a)) return a.map((x) => fixPageRefs(x, old, name));
  if (isObj(a))
    return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, k === "page" && v === old && PAGE_ACTIONS.has(String(a.type)) ? name : fixPageRefs(v, old, name)]));
  return a;
}

/** O resto do config que cita a página pelo nome: páginas temporárias, automações e a luz de cada página. */
function renameElsewhere(d: Config, old: string, name: string) {
  if (Array.isArray(d.temp_pages)) d.temp_pages = d.temp_pages.map((p) => (p === old ? name : p));
  if (Array.isArray(d.automations))
    for (const a of d.automations as unknown[]) {
      if (!isObj(a)) continue;
      if (isObj(a.when) && a.when.type === "page" && a.when.page === old) a.when.page = name;
      if (a.do !== undefined) a.do = fixPageRefs(a.do, old, name);
    }
  const light = isObj(d.lighting) ? d.lighting : null;
  if (light && isObj(light.pages) && old in light.pages)
    light.pages = Object.fromEntries(Object.entries(light.pages).map(([k, v]) => [k === old ? name : k, v]));
}

/** Apagou a página: some das temporárias e da luz por página (as automações ficam; a conferência avisa). */
function deleteElsewhere(d: Config, name: string) {
  if (Array.isArray(d.temp_pages)) {
    d.temp_pages = d.temp_pages.filter((p) => p !== name);
    if (!(d.temp_pages as unknown[]).length) Reflect.deleteProperty(d, "temp_pages");
  }
  const light = isObj(d.lighting) ? d.lighting : null;
  if (light && isObj(light.pages)) Reflect.deleteProperty(light.pages, name);
}

export function renamePage(t: T, old: string, raw: string) {
  const name = raw.trim();
  useRenaming.setState({ name: null });
  if (!name || name === old) return;
  // "." e ".." no endereço o navegador lê como pasta (/teclas/.. vira /): a página se perderia ao recarregar
  if (name === "." || name === "..") {
    toast(t("“{0}” can't be a page name.", [name]), { bad: true });
    return;
  }
  if (pagesOf(useConfig.getState().cfg)[name]) {
    toast(t("There's already a page called {0}.", [name]), { bad: true });
    return;
  }
  useConfig.getState().edit((d) => {
    const pages = (d.pages ?? {}) as Record<string, PageKeys>;
    // mesma ordem das abas, com o nome novo no lugar
    d.pages = Object.fromEntries(Object.entries(pages).map(([k, v]) => [k === old ? name : k, v]));
    if (d.home === old) d.home = name;
    for (const keys of Object.values(d.pages as Record<string, PageKeys>))
      for (const spec of Object.values(keys)) for (const f of MOMENTS) if (spec && spec[f] !== undefined) spec[f] = fixPageRefs(spec[f], old, name);
    renameElsewhere(d, old, name);
  });
  useUi.getState().go({ page: name });
  toast(t("Page renamed to {0}. The buttons that led to it were updated.", [name]));
}

export function deletePage(t: T, name: string) {
  const cfg = useConfig.getState().cfg;
  const n = Object.keys(pagesOf(cfg)[name] ?? {}).length;
  useConfig.getState().edit((d: Config) => {
    const pages = (d.pages ?? {}) as Record<string, PageKeys>;
    Reflect.deleteProperty(pages, name);
    if (d.home === name) d.home = Object.keys(pages)[0];
    deleteElsewhere(d, name);
  });
  useUi.getState().go({ page: Object.keys(pagesOf(useConfig.getState().cfg))[0] ?? null, key: null });
  toast(!n ? t("Page {0} deleted.", [name]) : n === 1 ? t('Page "{0}" deleted, with 1 key.', [name]) : t('Page "{0}" deleted, with {1} keys.', [name, n]), {
    undo: undoButton(t),
    long: n > 0,
  });
}

export function setHome(name: string) {
  useConfig.getState().edit((d) => void (d.home = name));
}

/** Leva a tecla para a primeira casa livre da outra página. */
export function moveKeyToPage(t: T, from: string, key: string, target: string) {
  const cfg = useConfig.getState().cfg;
  const dst = pagesOf(cfg)[target] ?? {};
  const [cols, rows] = spanOf(pagesOf(cfg)[from]?.[key]);
  const cover = coverMap(dst);
  const taken = (k: string) => !!dst[k] || !!cover[k];
  // a tecla (ou o bloco inteiro) num lugar livre; o antigo punha o bloco na primeira casa livre, mesmo sem caber
  const free = KEYS.find((k) => {
    const cells = footprint(k, cols, rows);
    return !!cells && !cells.some(taken);
  });
  if (!free) {
    toast(t("Page {0} is full.", [target]), { bad: true });
    return;
  }
  useConfig.getState().edit((d) => {
    const src = draftKeys(d, from);
    const spec = src[key];
    if (!spec) return;
    draftKeys(d, target)[free] = spec;
    Reflect.deleteProperty(src, key);
  });
  useUi.getState().go({ key: null });
  toast(t("Key moved to page {0}.", [target]), { undo: undoButton(t) });
}
