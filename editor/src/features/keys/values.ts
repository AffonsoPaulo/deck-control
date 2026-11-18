// Os valores que as teclas podem mostrar ({clock.hour}, {obs.scene}...): a lista (schema) e o valor de agora
// (/api/values, a cada 5 s, como no editor atual). Sem o app, vale o exemplo do valor; sem exemplo, "–".
import { useQuery } from "@tanstack/react-query";
import { api } from "@/core/api";
import type { Obj } from "@/core/obj";
import { useSchema } from "@/core/queries";

export interface ValueDef {
  id: string;
  label: string;
  group: string;
  kind: string; // number | text | bool | icon | color
  sample?: unknown;
}

/** {id} ou {id|formato} dentro de um texto. */
export const TOKEN_RE = /\{([A-Za-z0-9_.:\-$]+)(?:\|([a-z0-9]+))?\}/g;
export const hasTokens = (s: unknown): boolean => typeof s === "string" && /\{[A-Za-z0-9_.:\-$]+(\|[a-z0-9]+)?\}/.test(s);

export function useValueDefs(): ValueDef[] {
  return ((useSchema().data?.values ?? []) as Obj[]).map((v) => ({
    id: String(v.id),
    label: String(v.label ?? v.id),
    group: String(v.group ?? ""),
    kind: String(v.kind ?? "text"),
    sample: v.sample,
  }));
}

/** Os valores agora (lista vazia com o app fechado). */
export function useLiveValues(enabled = true): Record<string, string | null> {
  const q = useQuery({
    queryKey: ["values"],
    queryFn: async () => {
      try {
        return (await api("GET /api/values")).values;
      } catch {
        return {};
      }
    },
    enabled,
    refetchInterval: 5000,
    staleTime: 0,
  });
  return q.data ?? {};
}

export const valueLabel = (defs: ValueDef[], id: string): string => defs.find((v) => v.id === id)?.label ?? id;

export function valueNow(defs: ValueDef[], live: Record<string, string | null>, id: string): string {
  const v = live[id];
  if (v !== undefined && v !== null) return String(v);
  const s = defs.find((d) => d.id === id)?.sample;
  return s !== undefined && s !== null ? String(s) : "–";
}

/** O primeiro valor numérico (para barra e faixas novas). */
export const firstNumber = (defs: ValueDef[]): string => defs.find((v) => v.kind === "number")?.id ?? "system.volume";
