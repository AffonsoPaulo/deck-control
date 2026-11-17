// Ícone do Lucide com o traço do editor (1,75) e tamanho por token (size-icon-*).
import type { LucideIcon } from "lucide-react";
import { cn } from "@/core/cn";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

export const ICON_SIZE: Record<IconSize, string> = {
  xs: "size-icon-xs",
  sm: "size-icon-sm",
  md: "size-icon-md",
  lg: "size-icon-lg",
  xl: "size-icon-xl",
  "2xl": "size-icon-2xl",
};

interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  className?: string | undefined;
}

export function Icon({ icon: Glyph, size = "md", className }: IconProps) {
  return <Glyph aria-hidden="true" strokeWidth={1.75} className={cn("block flex-none", ICON_SIZE[size], className)} />;
}
