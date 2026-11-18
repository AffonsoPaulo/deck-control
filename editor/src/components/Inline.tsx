// Campos que vivem dentro de uma frase (o input.inl / select.inl do editor atual): "Se [valor] [é] [3]".
// Baixos (28 px), com a borda clara que aparece sobre qualquer fundo, e o texto um pouco menor.
import { ChevronDown } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";

/** O visual do campo em linha (também da seleção de valor em linha). */
export const INLINE_FIELD =
  "h-7 max-w-full rounded-sm border border-tint-line bg-field px-2 text-sm font-medium text-fg outline-none focus:border-accent focus:ring-3 focus:ring-accent-ring";

/** A seta da lista em linha (no lugar da nativa, como no atual): envolva o <select> com isto e use
 * INLINE_SELECT nele. */
export const INLINE_SELECT = "cursor-pointer appearance-none truncate pr-7";
export function InlineSelectFrame({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <span className={cn("relative inline-flex max-w-full min-w-0", className)}>
      {children}
      <Icon icon={ChevronDown} size="xs" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-muted" />
    </span>
  );
}

interface InlineSelectProps<V> {
  options: [V, string][];
  value: V;
  onChange: (value: V) => void;
  label: string;
  className?: string;
}

/** Lista em linha; as opções podem ter qualquer valor (escolhe pelo índice, como o inlSelect do atual). */
export function InlineSelect<V>({ options, value, onChange, label, className }: InlineSelectProps<V>) {
  const idx = options.findIndex(([v]) => JSON.stringify(v) === JSON.stringify(value));
  return (
    <InlineSelectFrame className={className}>
      <select
        aria-label={label}
        value={String(idx >= 0 ? idx : 0)}
        onChange={(e) => {
          const o = options[Number(e.target.value)];
          if (o) onChange(o[0]);
        }}
        className={cn(INLINE_FIELD, INLINE_SELECT, "w-full")}
      >
        {options.map(([, l], i) => (
          <option key={i} value={String(i)}>
            {l}
          </option>
        ))}
      </select>
    </InlineSelectFrame>
  );
}

interface InlineInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  minChars?: number; // largura mínima, em caracteres (cresce com o texto, como o autosize do atual)
  maxChars?: number;
}

export const InlineInput = forwardRef<HTMLInputElement, InlineInputProps>(function InlineInput({ className, minChars = 6, maxChars = 30, ...rest }, ref) {
  const text = String(rest.value ?? rest.placeholder ?? "");
  return <input ref={ref} size={Math.max(minChars, Math.min(maxChars, text.length + 1))} className={cn(INLINE_FIELD, "w-auto", className)} {...rest} />;
});
