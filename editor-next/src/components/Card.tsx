// Cartão de um item escolhido (o .card do editor atual): miniatura, nome e detalhe, e botões à direita.
// Ícone da tecla, imagem, widget. Com onClick, o cartão inteiro é um botão.
import type { ReactNode } from "react";
import { cn } from "@/core/cn";

interface CardProps {
  thumb: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  subBad?: boolean; // detalhe em vermelho (arquivo não encontrado)
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function Card({ thumb, title, sub, subBad, actions, onClick, className }: CardProps) {
  const body = (
    <>
      <span className="grid size-control-2xl flex-none place-items-center overflow-hidden rounded-sm bg-raised text-fg">{thumb}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <b className="truncate text-base font-semibold">{title}</b>
        {sub && <small className={cn("text-xs", subBad ? "text-danger-fg" : "text-fg-subtle")}>{sub}</small>}
      </span>
      {actions}
    </>
  );
  const base = "flex w-full items-center gap-3 rounded-lg border border-border bg-surface py-2 pr-1.5 pl-2 text-left";
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, "cursor-pointer hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent", className)}>
        {body}
      </button>
    );
  }
  return <div className={cn(base, className)}>{body}</div>;
}
