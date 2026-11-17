// Escolher um valor (hora, cena do OBS, temperatura...) numa lista agrupada: os valores do app e dos plugins.
// O mesmo do valueSelect do editor atual: filtra por tipo, e o valor que já está no config aparece mesmo que
// tenha sumido (plugin desligado).
import { INLINE_FIELD } from "@/components/Inline";
import { Select } from "@/components/Select";
import { useT } from "@/core/i18n";
import type { Obj } from "@/core/obj";
import { useSchema } from "@/core/queries";
import { cn } from "@/core/cn";

interface ValueSelectProps {
  value: string | null;
  onPick: (id: string | null) => void;
  kinds?: string[];
  label?: string;
  empty?: string; // primeira opção vazia ("escolha um valor…")
  size?: "md" | "sm" | "inline"; // inline: dentro de uma frase (28 px)
  className?: string;
}

export function ValueSelect({ value, onPick, kinds, label, empty, size, className }: ValueSelectProps) {
  const t = useT();
  const defs = ((useSchema().data?.values ?? []) as Obj[]).filter((v) => !kinds || kinds.includes(String(v.kind)));
  const options = [
    ...(empty ? [{ value: "", label: empty }] : []),
    ...defs.map((v) => ({ value: String(v.id), label: String(v.label), group: String(v.group) })),
    ...(value && !defs.some((v) => v.id === value) ? [{ value, label: value }] : []),
  ];
  if (size === "inline") {
    return (
      <select
        aria-label={label ?? t("Value")}
        value={value ?? ""}
        onChange={(e) => onPick(e.target.value || null)}
        className={cn(INLINE_FIELD, "cursor-pointer truncate", className)}
      >
        {empty && <option value="">{empty}</option>}
        {groups(defs).map(([g, items]) => (
          <optgroup key={g} label={g}>
            {items.map((v) => (
              <option key={String(v.id)} value={String(v.id)}>
                {String(v.label)}
              </option>
            ))}
          </optgroup>
        ))}
        {value && !defs.some((v) => v.id === value) && <option value={value}>{value}</option>}
      </select>
    );
  }
  return (
    <Select
      aria-label={label ?? t("Value")}
      value={value ?? ""}
      onChange={(v) => onPick(v || null)}
      options={options}
      {...(size === "sm" ? { size } : {})}
      {...(className ? { className } : {})}
    />
  );
}

function groups(defs: Obj[]): [string, Obj[]][] {
  const by = new Map<string, Obj[]>();
  for (const v of defs) {
    const g = String(v.group);
    by.set(g, [...(by.get(g) ?? []), v]);
  }
  return [...by.entries()];
}
