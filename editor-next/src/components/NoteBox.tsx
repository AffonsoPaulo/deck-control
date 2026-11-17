// Caixa de aviso com ícone (o .note-box do editor atual): "bad" para o que pede atenção (atalho repetido).
// O botão opcional fica à direita e desce para a linha de baixo quando falta espaço.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";

interface NoteBoxProps {
  icon: LucideIcon;
  children: ReactNode;
  tone?: "default" | "bad";
  action?: ReactNode;
  status?: boolean; // anuncia ao aparecer (role="status")
  className?: string;
}

export function NoteBox({ icon, children, tone = "default", action, status, className }: NoteBoxProps) {
  return (
    <div
      role={status ? "status" : undefined}
      className={cn(
        "flex flex-wrap items-start gap-2.5 rounded-md px-3 py-2.5 text-sm leading-4.5",
        tone === "bad" ? "bg-danger-bg text-fg-label" : "bg-sunken text-fg-muted",
        className,
      )}
    >
      <Icon icon={icon} className="mt-px text-fg-subtle" />
      <span className="min-w-50 flex-1">{children}</span>
      {action}
    </div>
  );
}
