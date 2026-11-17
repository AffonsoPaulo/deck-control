// Folha (o .sheet do editor atual): janela no meio da tela sobre o fundo escurecido, para escolher ícone, ação ou
// ver o histórico. Base UI Dialog por baixo: foco preso dentro, Esc e clique fora fecham, o foco volta.
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import { useOverlay } from "@/core/overlay";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string; // nome da janela para o leitor de tela ("Escolher ícone")
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

const MOTION =
  "motion-safe:transition motion-safe:duration-(--duration-slow) motion-safe:ease-out motion-safe:data-ending-style:duration-(--duration-base) motion-safe:data-ending-style:ease-in";

export function Sheet({ open, onOpenChange, label, children, initialFocus, className }: SheetProps) {
  useOverlay(open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-(--z-dialog) bg-scrim data-starting-style:opacity-0 data-ending-style:opacity-0",
            "motion-safe:transition-opacity motion-safe:duration-(--duration-base)",
          )}
        />
        <Dialog.Viewport className="fixed inset-0 z-(--z-dialog) grid place-items-center p-6">
          <Dialog.Popup
            aria-label={label}
            initialFocus={initialFocus}
            className={cn(
              "flex max-h-sheet w-190 max-w-full flex-col rounded-xl border border-border bg-surface p-4.5 text-fg shadow-dialog outline-none",
              "data-starting-style:translate-y-2 data-starting-style:scale-98 data-starting-style:opacity-0",
              "data-ending-style:translate-y-1 data-ending-style:scale-98 data-ending-style:opacity-0",
              MOTION,
              className,
            )}
          >
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A linha de cima da folha: o que vier (busca, título) e o botão de fechar. */
export function SheetHead({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="mb-3.5 flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <Dialog.Close render={<IconButton icon={X} label={t("Close")} />} />
    </div>
  );
}
