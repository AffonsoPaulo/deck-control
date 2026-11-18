// Peças pequenas para ler o config (JSON aberto): "é um objeto?" e o ícone como objeto.

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** O ícone de uma tecla como objeto (texto sozinho vira { text }; o resto que não é objeto, {}). */
export const normalizeIcon = (v: unknown): Obj => (typeof v === "string" ? { text: v } : isObj(v) ? v : {});

/** Cópia funda de um valor JSON. */
export const clone = <V>(v: V): V => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as V));
