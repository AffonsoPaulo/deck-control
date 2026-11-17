// A miniatura de um widget num tamanho: uma grade de teclas com o desenho de verdade de cada uma (biblioteca,
// aba Widget). Apagada (dim) quando o tamanho não cabe.
import { cn } from "@/core/cn";

/** A miniatura de um widget num tamanho: uma grade de teclas com o desenho de verdade de cada uma. */
export function WidgetThumb({ srcs, cols, rows, unit, dim }: { srcs: string[]; cols: number; rows: number; unit: number; dim?: boolean }) {
  return (
    <span aria-hidden className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${cols}, ${unit}px)`, gridAutoRows: `${unit}px` }}>
      {Array.from({ length: cols * rows }, (_, i) => (
        <span key={i} className="block overflow-hidden rounded-xs bg-key-graphite inset-ring inset-ring-tint-hover">
          {srcs[i] && <img src={srcs[i]} alt="" className={cn("block size-full", dim && "brightness-60 grayscale")} />}
        </span>
      ))}
    </span>
  );
}
