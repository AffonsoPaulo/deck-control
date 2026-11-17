// O config conferido pelo servidor enquanto se edita (o scheduleValidate do editor atual, 400 ms depois da
// última mudança): os problemas que impedem salvar e os atalhos repetidos (salvar ainda funciona). Quem confere
// é a casca (uma vez só, para o aviso de atalho repetido não sair em dobro); quem mostra lê useValidationState.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { api } from "@/core/api";
import type { ShortcutConflict } from "@/core/api-types";
import { useT } from "@/core/i18n";
import type { Obj } from "@/core/obj";
import { useConfig } from "@/core/store/config";
import { toast } from "@/core/toast";
import { useDebounced } from "@/core/useDebounced";

/** 'Shift+Ctrl+F13' -> 'ctrl+shift+f13' (igual ao binds.canonical do Python). */
export function canonCombo(c: unknown): string {
  const rank: Record<string, number> = { ctrl: 0, control: 0, lctrl: 0, rctrl: 0, shift: 1, lshift: 1, rshift: 1, alt: 2, lalt: 2, ralt: 2, altgr: 2, win: 3, lwin: 3, rwin: 3 };
  const parts = String(c ?? "").toLowerCase().replace(/\s/g, "").split("+").filter(Boolean);
  const mods = [...new Set(parts.filter((x) => x in rank).map((x) => rank[x] as number))].sort();
  return [...mods.map((m) => ["ctrl", "shift", "alt", "win"][m]), ...parts.filter((x) => !(x in rank))].join("+");
}

export interface Validation {
  errors: string[];
  conflicts: ShortcutConflict[];
}

/** O último resultado, para quem mostra (painel, campos de atalho); quem confere é a seção (useValidation). */
export const useValidationState = create<Validation>()(() => ({ errors: [], conflicts: [] }));

/** Confere o config a cada mudança (vazio enquanto não chega, ou com o app fechado). */
export function useValidation(): Validation {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  const body = useDebounced(cfg ? JSON.stringify(cfg) : "", 400);
  const q = useQuery({
    queryKey: ["validate", body],
    enabled: body !== "",
    staleTime: Infinity,
    gcTime: 10_000,
    placeholderData: (prev) => prev,
    // falhou (app fechado, rede): fica o resultado anterior, como no atual; senão o próximo que der certo
    // pareceria um atalho repetido novo
    queryFn: async () => {
      const r = await api("POST /api/validate", { config: JSON.parse(body) as Obj });
      return { errors: r.ok ? [] : r.errors, conflicts: r.conflicts };
    },
    retry: false,
  });
  const v = q.data ?? { errors: [], conflicts: [] };
  useEffect(() => {
    if (q.data) useValidationState.setState(q.data);
  }, [q.data]);
  // surgiu um atalho repetido agora (não ao abrir): avisa. Compara quais atalhos, não quantos: um repetido
  // pode trocar de lugar com outro
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!q.data) return;
    const now = new Set(q.data.conflicts.map((c) => c.combo));
    if (seen.current && [...now].some((c) => !seen.current?.has(c))) toast(t("Two different things now use the same shortcut. See the warning below the shortcut."), { bad: true });
    seen.current = now;
  }, [q.data, t]);
  return v;
}

/** Os outros lugares que usam o mesmo atalho (sem o próprio). */
export function otherPlaces(conflicts: ShortcutConflict[], combo: unknown, isSelf: (p: Obj) => boolean): Obj[] {
  const c = conflicts.find((x) => x.combo === canonCombo(combo));
  return c ? (c.places as unknown as Obj[]).filter((p) => !isSelf(p)) : [];
}
