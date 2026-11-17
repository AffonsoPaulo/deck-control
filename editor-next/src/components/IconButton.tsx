// Botão só com ícone (desfazer, refazer, histórico...). O nome vai no aria-label e no title.
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";

const iconButton = cva(
  "grid flex-none cursor-pointer place-items-center rounded-md text-fg-muted transition-colors duration-(--duration-fast) hover:enabled:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-35",
  {
    variants: {
      size: {
        sm: "size-control-sm rounded-sm",
        lg: "size-control-lg",
      },
    },
    defaultVariants: { size: "lg" },
  },
);

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">, VariantProps<typeof iconButton> {
  icon: LucideIcon;
  label: string;
}

export function IconButton({ icon, label, size, className, title, ...rest }: IconButtonProps) {
  return (
    <button type="button" aria-label={label} title={title ?? label} className={cn(iconButton({ size }), className)} {...rest}>
      <Icon icon={icon} />
    </button>
  );
}
