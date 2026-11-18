// Caixa de aviso com ícone (o .note-box do editor atual): "bad" para o que pede atenção (atalho repetido);
// "info" é o .info-note (texto mais forte, ícone violeta), nas Automações.
// O botão opcional fica à direita e desce para a linha de baixo quando falta espaço.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { catStyle } from "@/components/Library";
import { cn } from "@/core/cn";

interface NoteBoxProps {
  icon: LucideIcon;
  children: ReactNode;
  tone?: "default" | "bad" | "info";
  action?: ReactNode;
  status?: boolean; // anuncia ao aparecer (role="status")
  className?: string;
}

export function NoteBox({ icon, children, tone = "default", action, status, className }: NoteBoxProps) {
  return (
    <div
      role={status ? "status" : undefined}
      className={cn(
        "flex flex-wrap items-start gap-2.5 rounded-md px-3 py-2.5 text-sm",
        tone === "bad" ? "bg-danger-bg leading-4.5 text-fg-label" : tone === "info" ? "bg-sunken text-fg-label" : "bg-sunken leading-4.5 text-fg-muted",
        className,
      )}
    >
      <span className="contents" style={tone === "info" ? catStyle("var(--cat-violet)") : undefined}>
        <Icon icon={icon} className={cn("mt-px", tone === "info" ? "text-cat-ink" : "text-fg-subtle")} />
      </span>
      <span className="min-w-50 flex-1">{children}</span>
      {action}
    </div>
  );
}
