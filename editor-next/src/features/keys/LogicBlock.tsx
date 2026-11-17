// O bloco de lógica (o .cblk do editor atual): a barra com o ícone da categoria, a frase ("Se [valor] [é] [3]") e
// as ferramentas, e o corpo recuado com o que vale dentro dele. Usado nas regras da tecla de informação e nos
// passos "Se / senão" de "O que faz".
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { catStyle } from "@/components/Library";

interface LogicBlockProps {
  icon: LucideIcon;
  color?: string; // a base da categoria (padrão: laranja, "Páginas e lógica")
  words: ReactNode; // a frase da barra
  tools?: ReactNode;
  children?: ReactNode; // o corpo
}

export function LogicBlock({ icon, color = "var(--cat-orange)", words, tools, children }: LogicBlockProps) {
  return (
    <div style={catStyle(color)} className="rounded-lg bg-sunken text-fg inset-ring inset-ring-selected">
      <div className="flex min-h-control-2xl items-center gap-2 pr-1 pl-2.5 text-base font-semibold">
        <span aria-hidden className="grid h-7.5 w-4.5 flex-none place-items-center text-cat-ink">
          <Icon icon={icon} />
        </span>
        <span className="flex min-h-7.5 min-w-0 flex-1 flex-wrap items-center gap-1.5">{words}</span>
        {tools}
      </div>
      {children !== undefined && <div className="ml-4 rounded-l-md bg-field p-1.5">{children}</div>}
      <div className="h-2" />
    </div>
  );
}

/** A palavra-chave da frase ("Se", "Senão"): uma etiqueta. */
export function ChipLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-control-sm items-center rounded-sm border border-border-strong bg-border px-2.5 text-sm font-semibold text-fg">{children}</span>
  );
}
