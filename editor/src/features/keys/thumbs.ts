// Miniaturas dos widgets (o desenho de verdade de cada tecla, feito pelo servidor): um pedido para tudo o que a
// lista mostra, e um cache para a peça arrastada achar as imagens sem pedir de novo.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/core/api";
import { useConfig } from "@/core/store/config";

export interface ThumbItem {
  widget: string;
  size: string;
  options: Record<string, unknown> | null;
  colors: Record<string, unknown> | null;
}

const cache = new Map<string, string[]>();
const keyOf = (it: ThumbItem) => JSON.stringify([it.widget, it.size, it.options, it.colors]);

/** As imagens já carregadas de uma miniatura (para a peça arrastada). */
export const cachedThumb = (it: ThumbItem): string[] | undefined => cache.get(keyOf(it));

/** As imagens de cada miniatura pedida (lista vazia enquanto não chegam). */
export function useThumbs(items: ThumbItem[]): (it: ThumbItem) => string[] {
  const widgets = useConfig((s) => s.cfg?.widgets ?? null);
  const icons = useConfig((s) => s.cfg?.icons ?? null);
  const device = useConfig((s) => s.cfg?.device ?? null);
  const body = JSON.stringify({ keys: items, widgets, icons, device });
  useQuery({
    queryKey: ["thumbs", body],
    enabled: items.length > 0,
    staleTime: Infinity,
    gcTime: 60_000,
    queryFn: async () => {
      const r = await api("POST /api/preview", JSON.parse(body) as Parameters<typeof api<"POST /api/preview">>[1]);
      r.images.forEach((img, i) => {
        const it = items[i];
        if (!it) return;
        const cells = img && "cells" in img ? img.cells : img?.normal ? [img.normal] : [];
        cache.set(keyOf(it), cells);
      });
      return true;
    },
  });
  return (it) => cache.get(keyOf(it)) ?? [];
}
