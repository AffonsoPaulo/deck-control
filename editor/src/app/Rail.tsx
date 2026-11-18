// Trilho da esquerda: a marca e as seções (Teclas, Luz, Automações, Logs, Config), como no editor atual.
import { LayoutGrid, Lightbulb, ScrollText, Settings, Zap, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";
import type { Section } from "@/core/hash";
import { useT } from "@/core/i18n";

interface Item {
  section: Section;
  icon: LucideIcon;
  label: string; // chave de tradução
}

const ITEMS: Item[] = [
  { section: "keys", icon: LayoutGrid, label: "Keys" },
  { section: "light", icon: Lightbulb, label: "Light" },
  { section: "auto", icon: Zap, label: "Automations" },
  { section: "logs", icon: ScrollText, label: "Logs" },
  { section: "settings", icon: Settings, label: "Settings##3" },
];

interface RailProps {
  current: Section;
  showLogs: boolean;
  brand: string; // favicon aceso (Deck conectado) ou apagado
  onSelect: (s: Section) => void;
  newErrors?: number; // erros novos no log (selo no botão Logs, fora da tela Logs)
}

export function Rail({ current, showLogs, brand, onSelect, newErrors = 0 }: RailProps) {
  const t = useT();
  return (
    <nav
      aria-label={t("Sections")}
      className="flex h-dvh w-rail flex-none flex-col items-center gap-1.5 border-r border-border bg-field py-3"
    >
      <img src={brand} alt="Deck" width={36} height={36} className="mb-3 block size-9" />
      {ITEMS.filter((i) => i.section !== "logs" || showLogs).map((i) => {
        const on = i.section === current;
        return (
          <button
            key={i.section}
            type="button"
            aria-current={on ? "page" : "false"}
            onClick={() => onSelect(i.section)}
            className={cn(
              "relative flex w-rail-btn cursor-pointer flex-col items-center gap-1.5 rounded-lg pt-2.25 pb-2 text-2xs/(--text-sm--line-height) font-semibold",
              "transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-accent",
              on ? "bg-sunken text-fg inset-ring inset-ring-border" : "text-fg-subtle hover:bg-surface hover:text-fg",
            )}
          >
            <Icon icon={i.icon} size="lg" className={on ? "text-accent" : undefined} />
            <span>{t(i.label)}</span>
            {i.section === "logs" && newErrors > 0 && !on && (
              <span
                aria-label={t("{0} new errors", [newErrors])}
                className="absolute top-1 right-2.5 h-4.5 min-w-4.5 rounded-md bg-danger-solid px-1.25 text-center text-2xs leading-4.5 font-bold text-on-danger"
              >
                {newErrors > 99 ? "99+" : newErrors}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
