// Onde a pessoa está fica na URL, no MESMO formato do editor atual (app.js, syncHash), para um endereço servir
// nos dois editores e o F5 voltar para o mesmo lugar:  #t=TOKEN&s=light&set=about&p=main&k=3&tab=look...
// O token (t) vai sempre primeiro e nunca se perde.

export type Section = "keys" | "light" | "auto" | "logs" | "settings";
export const SECTIONS: readonly Section[] = ["keys", "light", "auto", "logs", "settings"];
export const SET_SECTIONS = ["general", "look", "integrations", "advanced", "backup", "about"] as const;
export type SetSection = (typeof SET_SECTIONS)[number];

export interface Place {
  section: Section;
  setSection: SetSection;
  page: string | null;
  key: string | null; // "1".."15"
  tab: "do" | "look" | "light";
  lookMode: "normal" | "active";
  lightMoment: "press" | "hold" | "release";
  view: "normal" | "active";
  expanded: boolean;
}

export const DEFAULT_PLACE: Place = {
  section: "keys",
  setSection: "general",
  page: null,
  key: null,
  tab: "do",
  lookMode: "normal",
  lightMoment: "press",
  view: "normal",
  expanded: false,
};

const KEYS = Array.from({ length: 15 }, (_, i) => String(i + 1));

/** Lê a URL (só o que o editor atual também entende; o resto fica no padrão). */
export function parsePlace(hash: string): Place {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const p: Place = { ...DEFAULT_PLACE };
  const s = q.get("s");
  if (s === "light" || s === "settings" || s === "auto" || s === "logs") p.section = s;
  if (q.get("open") === "settings") p.section = "settings";
  const set = q.get("set");
  if ((SET_SECTIONS as readonly string[]).includes(set ?? "")) p.setSection = set as SetSection;
  p.page = q.get("p");
  const k = q.get("k");
  p.key = k && KEYS.includes(k) ? k : null;
  const tab = q.get("tab");
  if (tab === "look" || tab === "light") p.tab = tab;
  if (q.get("lm") === "active") p.lookMode = "active";
  const lt = q.get("lt");
  if (lt === "hold" || lt === "release") p.lightMoment = lt;
  if (q.get("v") === "active") p.view = "active";
  p.expanded = q.get("x") === "1" && !!p.key;
  return p;
}

/** Escreve a URL do jeito do editor atual (mesma ordem e mesmas omissões). */
export function formatPlace(p: Place, token: string): string {
  const q = new URLSearchParams({ t: token });
  if (p.section !== "keys") q.set("s", p.section);
  if (p.section === "settings" && p.setSection !== "general") q.set("set", p.setSection);
  if (p.page) q.set("p", p.page);
  if (p.key) {
    q.set("k", p.key);
    if (p.tab !== "do") q.set("tab", p.tab);
    if (p.tab === "look" && p.lookMode === "active") q.set("lm", "active");
    if (p.tab === "light" && p.lightMoment !== "press") q.set("lt", p.lightMoment);
    if (p.expanded) q.set("x", "1");
  }
  if (p.view === "active") q.set("v", "active");
  return "#" + q.toString();
}
