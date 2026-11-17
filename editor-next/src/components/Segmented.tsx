// O trilho de escolha do design system (cinza; o escolhido em --selected com texto --fg). Variantes do editor
// atual: normal (.segmented), largura toda (.segmented.full), pequeno (.segmented.small), só ícones
// (.segmented.icons) e pílulas (.pills, da Config e dos logs).
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";

const track = cva("gap-0.5 rounded-lg bg-sunken p-0.75", {
  variants: {
    variant: { default: "inline-flex", full: "flex w-full", small: "inline-flex self-start", icons: "inline-flex", pills: "inline-flex" },
  },
  defaultVariants: { variant: "default" },
});

const option = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-selected aria-pressed:text-fg not-aria-pressed:text-fg-muted not-aria-pressed:hover:bg-tint-hover not-aria-pressed:hover:text-fg",
  {
    variants: {
      variant: {
        default: "h-control-md px-3.25 font-medium",
        full: "h-control-md flex-1 px-3.25 font-semibold",
        small: "h-control-sm px-2.5 font-medium",
        icons: "size-control-md font-medium",
        pills: "h-control-md px-3 font-semibold",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface SegmentedOption<T extends string> {
  value: T;
  label: string; // nas "icons", vira o aria-label e o title
  icon?: LucideIcon;
}

interface SegmentedProps<T extends string> extends VariantProps<typeof track> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string; // o que se escolhe (aria-label do grupo)
  className?: string;
}

export function Segmented<T extends string>({ options, value, onChange, label, variant, className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn(track({ variant }), className)}>
      {options.map((o) => {
        const iconOnly = variant === "icons";
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            aria-label={iconOnly ? o.label : undefined}
            title={iconOnly ? o.label : undefined}
            onClick={() => onChange(o.value)}
            className={option({ variant })}
          >
            {o.icon && <Icon icon={o.icon} />}
            {!iconOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}
