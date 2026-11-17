// Peças da biblioteca (Teclas › biblioteca, e a página do plugin): o grupo em sanfona, o subtítulo de origem,
// o quadradinho colorido da categoria e a peça de tamanho do widget. A cor vem da categoria: quem usa passa a
// base (`--cat-<matiz>`) e as fórmulas do tema fazem o resto (chip, tinta, bloco).
import type { LucideIcon } from "lucide-react";
import { Bookmark, ChevronRight, LayoutGrid, Plug } from "lucide-react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";

/** style com a cor da categoria (ex.: catStyle("var(--cat-blue)")). */
export const catStyle = (color: string): CSSProperties => ({ "--cat": color }) as CSSProperties;

interface LibGroupProps {
  label: string;
  color: string; // a base da categoria, ex.: "var(--cat-blue)"
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** Grupo da biblioteca: cabeçalho em sanfona (quadradinho, nome, quantos, seta) e, aberto, os filhos recuados com
 * a linha que desce do quadradinho. Quem decide se está aberto é quem usa (buscando: tudo aberto). */
export function LibGroup({ label, color, count, open, onToggle, children }: LibGroupProps) {
  return (
    <section style={catStyle(color)} className="not-first:mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2.25 text-left text-sm font-bold text-fg hover:bg-sunken focus-visible:outline-2 focus-visible:outline-accent"
      >
        <i aria-hidden className="size-2.5 flex-none rounded-xs bg-cat" />
        <span className="flex-1">{label}</span>
        <span className="text-xs font-medium text-fg-subtle">{count}</span>
        <Icon
          icon={ChevronRight}
          className="text-fg-subtle transition-transform duration-(--duration-fast) ease-out group-aria-expanded:rotate-90 motion-reduce:transition-none"
        />
      </button>
      {open && (
        <div className="relative mb-1.5 ml-5 before:pointer-events-none before:absolute before:inset-y-0 before:-left-2 before:w-px before:bg-border-strong">
          {children}
        </div>
      )}
    </section>
  );
}

export type Origin = "app" | "mine" | "plugin";
const ORIGIN_ICON: Record<Origin, LucideIcon> = { app: LayoutGrid, mine: Bookmark, plugin: Plug };

/** Subtítulo dentro do grupo quando ele mistura origens: do app, meus ou de um plugin, com a linha até o fim. */
export function LibSub({ origin, label }: { origin: Origin; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-2.25 pb-1 text-xs font-semibold text-fg-subtle">
      <Icon icon={ORIGIN_ICON[origin]} size="xs" />
      {label}
      <span aria-hidden className="ml-1 h-px flex-1 bg-border" />
    </div>
  );
}

/** Quadradinho colorido com o ícone (o .chip): o ícone é o caractere da fonte Lucide ou um ícone do lucide-react. */
export function Chip({ glyph, icon, size = "md", className }: { glyph?: string; icon?: LucideIcon; size?: "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid flex-none place-items-center bg-cat-chip text-cat-ink",
        size === "lg" ? "size-control-lg rounded-md" : "size-7.5 rounded-sm",
        className,
      )}
    >
      {icon ? <Icon icon={icon} size={size === "lg" ? "lg" : "md"} /> : <span className="font-lucide text-(length:--icon-md) leading-none">{glyph}</span>}
    </span>
  );
}

interface SizeTileProps {
  label: string; // "2×2"
  rows: number; // linhas do tamanho (a altura da arte acompanha)
  unit?: number; // px de uma tecla na miniatura
  pressed?: boolean; // escolhido (inspetor); sem valor = não é escolha (biblioteca)
  disabled?: boolean;
  note?: string;
  title?: string;
  compact?: boolean; // na biblioteca (.pieces): mais justo e estica para ocupar a linha
  onClick?: () => void;
  children: ReactNode; // a miniatura (a de verdade, renderizada pelo app)
  ref?: Ref<HTMLButtonElement>; // para arrastar a peça
}

/** Peça de tamanho do widget: a miniatura em cima e o tamanho embaixo (biblioteca, inspetor, página do plugin). */
export function SizeTile({ label, rows, unit = 20, pressed, disabled, note, title, compact, onClick, children, ref }: SizeTileProps) {
  const r = Math.max(2, rows);
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-border bg-surface text-xs font-semibold text-fg-muted",
        "hover:enabled:border-border-strong hover:enabled:text-fg disabled:cursor-not-allowed disabled:opacity-55",
        "aria-pressed:border-accent aria-pressed:text-fg aria-pressed:inset-ring aria-pressed:inset-ring-accent",
        "focus-visible:outline-2 focus-visible:outline-accent",
        compact ? "flex-auto px-1.25 pt-1.5 pb-1" : "px-1.75 pt-1.75 pb-1.25",
      )}
    >
      <span className="flex items-center justify-center" style={{ height: r * unit + (r - 1) * 2 }}>
        {children}
      </span>
      <span>{label}</span>
      {note && <small className="-mt-0.75 text-2xs font-medium text-fg-subtle">{note}</small>}
    </button>
  );
}
