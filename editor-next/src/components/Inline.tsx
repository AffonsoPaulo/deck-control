// Campos que vivem dentro de uma frase (o input.inl / select.inl do editor atual): "Se [valor] [é] [3]".
// Baixos (28 px), com a borda clara que aparece sobre qualquer fundo, e o texto um pouco menor.
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/core/cn";

/** O visual do campo em linha (também da seleção de valor em linha). */
export const INLINE_FIELD = "h-7 max-w-full rounded-sm border border-tint-line bg-sunken px-2 text-sm font-medium text-fg outline-none focus:border-accent";

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
    <select
      aria-label={label}
      value={String(idx >= 0 ? idx : 0)}
      onChange={(e) => {
        const o = options[Number(e.target.value)];
        if (o) onChange(o[0]);
      }}
      className={cn(INLINE_FIELD, "cursor-pointer truncate", className)}
    >
      {options.map(([, l], i) => (
        <option key={i} value={String(i)}>
          {l}
        </option>
      ))}
    </select>
  );
}

interface InlineInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  min?: number; // largura mínima, em caracteres (cresce com o texto, como o autosize do atual)
  max?: number;
}

export const InlineInput = forwardRef<HTMLInputElement, InlineInputProps>(function InlineInput({ className, min = 6, max = 30, ...rest }, ref) {
  const text = String(rest.value ?? rest.placeholder ?? "");
  return <input ref={ref} size={Math.max(min, Math.min(max, text.length + 1))} className={cn(INLINE_FIELD, "w-auto", className)} {...rest} />;
});
