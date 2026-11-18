// Contador com − e + (o .stepper do editor atual): valor no meio, limites, passo.
import { Minus, Plus } from "lucide-react";
import { Icon } from "@/components/Icon";
import { useT } from "@/core/i18n";

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string; // o que o número é (para o leitor de tela: "tamanho do texto")
  format?: (value: number) => string;
}

const BTN =
  "grid size-control-lg cursor-pointer place-items-center rounded-full text-fg hover:enabled:bg-tint-hover disabled:cursor-default disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent";

export function Stepper({ value, onChange, min, max, step = 1, label, format = String }: StepperProps) {
  const t = useT();
  // como no editor atual: arredonda no passo, fica nos limites e não avisa se o valor não mudou
  const set = (d: number) => {
    const nv = Number(Math.min(max, Math.max(min, Math.round((value + d) / step) * step)).toFixed(4));
    if (nv !== value) onChange(nv);
  };
  return (
    <div role="group" aria-label={label} className="inline-flex h-control-2xl items-center rounded-full bg-raised px-1">
      <button type="button" className={BTN} aria-label={t("Decrease {0}", [label])} title={t("Decrease")} disabled={value <= min} onClick={() => set(-step)}>
        <Icon icon={Minus} size="lg" />
      </button>
      <span aria-live="polite" className="min-w-16 text-center font-semibold tabular-nums">
        {format(value)}
      </span>
      <button type="button" className={BTN} aria-label={t("Increase {0}", [label])} title={t("Increase")} disabled={value >= max} onClick={() => set(step)}>
        <Icon icon={Plus} size="lg" />
      </button>
    </div>
  );
}
