// Seletor de ícone das teclas (o #glyphSheet do editor atual): folha com busca, os mais usados e todos os
// ícones do Lucide. São ~1.600: a grade é virtual (só desenha as linhas na tela), rolando dentro da folha.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { TextInput } from "@/components/Field";
import { Sheet, SheetHead } from "@/components/Sheet";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import { loadLucideIndex, luChar, type LucideIndex } from "@/core/icons/lucide";
import { buildPopular, searchIcons } from "@/core/icons/search";
import { useSchema } from "@/core/queries";
import { useDebounced } from "@/core/useDebounced";

/** O índice do Lucide (carrega uma vez, na primeira vez que alguém pede). */
export function useLucideIndex(enabled = true): LucideIndex | undefined {
  return useQuery({ queryKey: ["lucide-index"], queryFn: loadLucideIndex, staleTime: Infinity, enabled }).data;
}

/** Os mais usados, traduzidos (precisam do schema, que diz qual Lucide substitui cada Segoe antigo). */
export function usePopularIcons() {
  const t = useT();
  const map = useSchema().data?.segoe_to_lucide;
  return useMemo(() => buildPopular(map ?? {}, t), [map, t]);
}

type Row = { head: string } | { items: [string, string | undefined][] };

const MIN_COL = 92; // minmax(92px, 1fr) do editor atual
const GAP = 4;

interface IconPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (name: string) => void;
}

export function IconPicker({ open, onOpenChange, onPick }: IconPickerProps) {
  const t = useT();
  const idx = useLucideIndex(open);
  const popular = usePopularIcons();
  const [query, setQuery] = useState("");
  const q = useDebounced(query, 120);
  const search = useRef<HTMLInputElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(7);

  // abriu de novo: busca vazia (como no editor atual); ajuste durante o render, sem efeito
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery("");
  }

  // quantas colunas cabem (a grade do atual é auto-fill com no mínimo 92 px)
  useEffect(() => {
    if (!scroller) return;
    const measure = () => setCols(Math.max(1, Math.floor((scroller.clientWidth + GAP) / (MIN_COL + GAP))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller]);

  const rows = useMemo<Row[]>(() => {
    if (!idx) return [];
    const chunk = (list: [string, string | undefined][]): Row[] => {
      const out: Row[] = [];
      for (let i = 0; i < list.length; i += cols) out.push({ items: list.slice(i, i + cols) });
      return out;
    };
    if (!q.trim()) {
      const rest = Object.keys(idx)
        .filter((n) => !popular.names[n])
        .map((n): [string, undefined] => [n, undefined]);
      return [{ head: t("Most used") }, ...chunk(popular.list), { head: t("All icons") }, ...chunk(rest)];
    }
    return chunk(searchIcons(idx, popular, q).map((n) => [n, popular.names[n]]));
  }, [idx, popular, q, cols, t]);

  const pick = (name: string) => {
    onOpenChange(false);
    onPick(name);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={t("Choose icon")} initialFocus={search}>
      <SheetHead>
        <TextInput
          ref={search}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("Search icons (e.g.: mic, play, folder, light)")}
          placeholder={t("Search icons (e.g.: mic, play, folder, light)")}
          className="flex-1"
        />
      </SheetHead>
      <div ref={setScroller} className="min-h-0 flex-1 overflow-auto" data-testid="icon-grid">
        {scroller && idx && rows.length > 0 && (
          <Virtuoso
            customScrollParent={scroller}
            data={rows}
            increaseViewportBy={400}
            computeItemKey={(i, row) => ("head" in row ? `h:${row.head}` : `${i}:${row.items[0]?.[0] ?? ""}`)}
            itemContent={(i, row) =>
              "head" in row ? (
                <h3 className={cn("mx-1 mb-0.5 text-xs font-semibold text-fg-subtle", i === 0 ? "mt-0" : "mt-2.5")}>{row.head}</h3>
              ) : (
                <div className="grid gap-1 pb-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                  {row.items.map(([name, label]) => (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      onClick={() => pick(name)}
                      className="grid cursor-pointer justify-items-center gap-1.5 rounded-md px-1 pt-3 pb-2.5 outline-none hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <span aria-hidden className="font-lucide text-(length:--icon-2xl) leading-none text-fg">
                        {luChar(idx, name)}
                      </span>
                      <span className="text-center text-xs leading-tight text-fg-muted">{label ?? name.replace(/-/g, " ")}</span>
                    </button>
                  ))}
                </div>
              )
            }
          />
        )}
        {idx && q.trim() && rows.length === 0 && (
          <p className="mt-3 mb-0 text-xs text-fg-subtle">{t("No icon with that name. Try in English too, like mic, play or folder.")}</p>
        )}
      </div>
      <p className="mt-3 mb-0 text-xs text-fg-subtle">
        {t("These are the Lucide icons (lucide.dev), the same ones used in the editor. Search works in English and Portuguese.")}
      </p>
    </Sheet>
  );
}
