// Ícones das teclas: a fonte do Lucide (a mesma lucide.ttf que o app usa para desenhar as teclas) e o índice
// nome -> [código, etiquetas em inglês]. O índice (117 KB) só carrega quando alguém precisa dele.
import indexUrl from "deck-static/lucide-index.json?url";

export type LucideIndex = Record<string, [number, string]>;

let loading: Promise<LucideIndex> | null = null;

export function loadLucideIndex(): Promise<LucideIndex> {
  loading ??= fetch(indexUrl)
    .then((r) => r.json() as Promise<LucideIndex>)
    .catch((e: unknown) => {
      loading = null; // deixa tentar de novo
      throw e;
    });
  return loading;
}

/** O caractere do ícone na fonte Lucide ("" se o nome não existe). */
export const luChar = (idx: LucideIndex, name: string): string => {
  const v = idx[name];
  return v ? String.fromCodePoint(v[0]) : "";
};

/** Ícone antigo (Segoe, "E720") como caractere; texto que não é código fica como está. */
export const glyphChar = (code: unknown): string => {
  const c = String(code ?? "").trim();
  return /^[0-9a-f]{4,5}$/i.test(c) ? String.fromCodePoint(parseInt(c, 16)) : c;
};

/** Sem acento e em minúsculas (para a busca). */
export const norm = (s: unknown): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
