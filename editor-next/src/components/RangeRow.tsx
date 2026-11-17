// Régua com rótulo à esquerda e o valor à direita (o .rrow do editor atual): tamanhos na Aparência, brilho,
// velocidade e alcance na Luz.
import type { ReactNode } from "react";
interface RangeRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  shown: string; // o valor como aparece ("80%", "Rápida", "auto")
  min?: number;
  max?: number;
  step?: number;
}

/** Linha com o rótulo à esquerda, alinhada ao centro (régua, trilho de escolha). */
export function LabelRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7.5 items-center gap-3">
      <span className="w-23 flex-none text-sm leading-7.5 text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

export function RangeRow({ label, value, onChange, shown, min = 0, max = 100, step }: RangeRowProps) {
  return (
    <LabelRow label={label}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={shown}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="w-10 text-right text-sm text-fg-muted tabular-nums">{shown}</span>
    </LabelRow>
  );
}
