// Lista de escolha nativa (o select do editor atual): mesmo campo do TextInput, com a seta à direita.
// Nativa de propósito: teclado, leitor de tela e a lista do Windows funcionam sem nada a mais.
import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";

export interface SelectOption {
  value: string;
  label: string;
  group?: string; // opções com o mesmo grupo ficam juntas, debaixo do nome dele (optgroup)
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "size"> {
  options: SelectOption[];
  onChange: (value: string) => void;
  size?: "md" | "sm"; // sm: 32 px (filtro da biblioteca)
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, onChange, className, size = "md", ...rest },
  ref,
) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select
        ref={ref}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          size === "sm" ? "h-control-md" : "h-control-lg",
          "w-full cursor-pointer appearance-none rounded-md border border-border-strong bg-sunken pr-7.5 pl-2.75 text-base text-fg outline-none focus:border-accent focus:ring-3 focus:ring-accent-ring disabled:cursor-default disabled:opacity-45",
        )}
        {...rest}
      >
        {options.map((o, i) => {
          if (o.group === undefined) return <Option key={o.value} o={o} />;
          if (options[i - 1]?.group === o.group) return null; // o grupo já saiu inteiro
          return (
            <optgroup key={`g:${o.group}`} label={o.group}>
              {options.filter((x) => x.group === o.group).map((x) => (
                <Option key={x.value} o={x} />
              ))}
            </optgroup>
          );
        })}
      </select>
      <Icon icon={ChevronDown} size="xs" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-muted" />
    </span>
  );
});

function Option({ o }: { o: SelectOption }) {
  return <option value={o.value}>{o.label}</option>;
}
