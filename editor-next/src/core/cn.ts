// Junta classes do Tailwind resolvendo conflitos (a última ganha), com os nomes dos nossos tokens.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["xs", "sm", "md", "lg", "xl", "full"],
      text: ["2xs", "xs", "sm", "base", "md", "lg", "xl", "2xl"],
      shadow: ["sm", "popover", "dialog", "drawer"],
      font: ["sans", "mono", "glyph"],
      ease: ["out", "in"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
