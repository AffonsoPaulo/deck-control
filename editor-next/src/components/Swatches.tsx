// Amostras de cor (o swatchRow do editor atual): "nenhuma" opcional, as cores e "outra cor" (a janela de cor do
// sistema). A paleta da tecla sai dos tokens --key-* (o que vai para o Deck), lida do CSS, nunca reescrita aqui.
import { Ban, Pipette } from "lucide-react";
import { useMemo } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";

export interface Swatch {
  value: string; // a cor como vai para o config (#rrggbb)
  label: string;
}

const cssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A paleta da tecla (KEY_SWATCHES do editor atual), com os valores dos tokens. */
export function useKeySwatches(): Swatch[] {
  const t = useT();
  return useMemo(
    () =>
      (
        [
          ["--key-graphite", t("Graphite")],
          ["--key-blue", t("Blue")],
          ["--key-sky", t("Sky blue")],
          ["--key-green", t("Green")],
          ["--key-amber-dark", t("Dark amber")],
          ["--key-red", t("Red")],
          ["--key-violet", t("Violet")],
          ["--key-discord", "Discord"],
          ["--key-amber", t("Amber")],
          ["--key-black", t("Black")],
        ] as const
      ).map(([v, label]) => ({ value: cssVar(v), label })),
    [t],
  );
}

const SWATCH =
  "grid size-control-xs cursor-pointer place-items-center rounded-sm inset-ring inset-ring-tint-line aria-pressed:ring-2 aria-pressed:ring-fg aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

const same = (a: string | null, b: string | null) => (a ?? "").toUpperCase() === (b ?? "").toUpperCase();

interface SwatchesProps {
  value: string | null;
  onChange: (value: string | null) => void;
  colors: Swatch[];
  /** Mostra a amostra "nenhuma" (vale null), com este rótulo. */
  noneLabel?: string;
  label: string; // o que a cor pinta (aria-label do grupo)
}

export function Swatches({ value, onChange, colors, noneLabel, label }: SwatchesProps) {
  const t = useT();
  const custom = value !== null && !colors.some((c) => same(c.value, value));
  const other = t("Other color");
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {noneLabel && (
        <button
          type="button"
          className={cn(SWATCH, "bg-surface text-fg-subtle")}
          title={noneLabel}
          aria-label={noneLabel}
          aria-pressed={value === null}
          onClick={() => onChange(null)}
        >
          <Icon icon={Ban} size="sm" />
        </button>
      )}
      {colors.map((c) => (
        <button
          key={c.value + c.label}
          type="button"
          className={SWATCH}
          style={{ background: c.value }}
          title={c.label}
          aria-label={c.label}
          aria-pressed={same(c.value, value)}
          onClick={() => onChange(c.value)}
        />
      ))}
      <label
        title={other}
        data-pressed={custom || undefined} // label não tem aria-pressed; o anel sai deste atributo
        className={cn(SWATCH, "relative overflow-hidden data-pressed:ring-2 data-pressed:ring-fg data-pressed:ring-offset-2 data-pressed:ring-offset-surface", custom ? "text-key-fg" : "inset-ring-0 bg-raised text-fg-muted")}
        style={custom ? { background: value } : undefined}
      >
        <Icon icon={Pipette} size="sm" className={custom ? "drop-shadow-halo" : undefined} />
        <input
          type="color"
          aria-label={other}
          value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? (value as string) : "#888888"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}
