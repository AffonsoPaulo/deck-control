// Botão com texto (e ícone opcional), igual ao .btn do editor atual: normal, primário, fantasma, vermelho sólido e
// texto vermelho; pequeno (32 px) ou normal (36 px).
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";

const button = cva(
  "inline-flex flex-none cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border font-semibold transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "border-border-strong bg-surface text-fg hover:enabled:bg-raised",
        primary: "min-w-23 border-accent bg-accent text-on-accent hover:enabled:bg-accent-hover",
        ghost: "border-transparent bg-transparent font-medium text-fg-muted hover:enabled:bg-raised",
        danger: "border-border-strong bg-surface text-danger-fg hover:enabled:bg-raised",
        solidDanger: "border-danger-solid bg-danger-solid text-on-danger hover:enabled:bg-danger-solid-hover",
      },
      size: {
        md: "h-control-lg px-3.5 text-base",
        sm: "h-control-md px-2.75 text-sm",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  icon?: LucideIcon | undefined;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { icon, variant, size, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(button({ variant, size }), className)} {...rest}>
      {icon && <Icon icon={icon} size={size === "sm" ? "sm" : "md"} />}
      {children}
    </button>
  );
});
