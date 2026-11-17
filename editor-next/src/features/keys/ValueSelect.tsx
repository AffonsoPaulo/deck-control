// Escolher um valor (hora, cena do OBS, temperatura...) numa lista agrupada: os valores do app e dos plugins.
// O mesmo do valueSelect do editor atual: filtra por tipo, e o valor que já está no config aparece mesmo que
// tenha sumido (plugin desligado).
import { Select } from "@/components/Select";
import { useT } from "@/core/i18n";
import type { Obj } from "@/core/obj";
import { useSchema } from "@/core/queries";

interface ValueSelectProps {
  value: string | null;
  onPick: (id: string | null) => void;
  kinds?: string[];
  label?: string;
  empty?: string; // primeira opção vazia ("escolha um valor…")
  size?: "md" | "sm";
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
  return (
    <Select
      aria-label={label ?? t("Value")}
      value={value ?? ""}
      onChange={(v) => onPick(v || null)}
      options={options}
      {...(size ? { size } : {})}
      {...(className ? { className } : {})}
    />
  );
}
