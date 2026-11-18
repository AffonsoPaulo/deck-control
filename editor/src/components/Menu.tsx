// Menus do editor (Base UI por baixo): o de botão ("…" da página) e o de botão direito (aba, tecla), com o visual
// do menu do editor atual: cabeçalho, itens com ícone e atalho, separador, item desativado e item vermelho.
//
// Item com `confirm` não age direto: o menu fecha e, no mesmo lugar, abre a confirmação (título, texto, Cancelar
// já com o foco e o botão vermelho), como no fluxo de excluir aprovado no canvas. Confirmação não fica dentro do
// menu: menu só pode ter itens de menu (acessibilidade); ela é um diálogo pequeno ancorado onde o menu estava.
import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import type { LucideIcon } from "lucide-react";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import { useOverlay } from "@/core/overlay";

export interface ConfirmSpec {
  title: string;
  text: string;
  confirmLabel: string;
  confirmIcon?: LucideIcon;
  onConfirm: () => void;
}

export type MenuEntry =
  | {
      type?: "item";
      label: string;
      icon?: LucideIcon;
      kbd?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect?: () => void;
      confirm?: ConfirmSpec;
    }
  | { type: "separator" }
  | { type: "head"; label: string };

const POPUP =
  "min-w-50 rounded-lg border border-border bg-surface p-1.5 text-base text-fg shadow-popover outline-none origin-(--transform-origin)";

function Entries({ items, onConfirm }: { items: MenuEntry[]; onConfirm: (c: ConfirmSpec) => void }) {
  return (
    <>
      {items.map((e, i) => {
        if (e.type === "separator") return <BaseMenu.Separator key={i} className="mx-1.5 my-1 h-px bg-border" />;
        if (e.type === "head") {
          return (
            <div key={i} className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-fg-subtle">
              {e.label}
            </div>
          );
        }
        return (
          <BaseMenu.Item
            key={i}
            disabled={e.disabled}
            onClick={() => (e.confirm ? onConfirm(e.confirm) : e.onSelect?.())}
            className={cn(
              "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-2 font-medium outline-none",
              "data-disabled:cursor-default data-disabled:opacity-45",
              e.danger
                ? "text-danger-fg data-highlighted:bg-danger-bg data-disabled:data-highlighted:bg-transparent"
                : "text-fg data-highlighted:bg-sunken data-disabled:data-highlighted:bg-transparent",
            )}
          >
            {e.icon && <Icon icon={e.icon} className={e.danger ? "text-danger-fg" : "text-fg-subtle"} />}
            <span className="flex-1">{e.label}</span>
            {e.kbd && <kbd className="font-sans text-xs text-fg-subtle">{e.kbd}</kbd>}
          </BaseMenu.Item>
        );
      })}
    </>
  );
}

/** Lugar na tela (o canto do menu que fechou), para a confirmação abrir ali. */
type Spot = { x: number; y: number };

function Confirm({ spec, spot, onClose }: { spec: ConfirmSpec | null; spot: Spot | null; onClose: () => void }) {
  const t = useT();
  const cancel = useRef<HTMLButtonElement>(null);
  const open = spec !== null && spot !== null;
  useOverlay(open);
  const anchor = spot && {
    getBoundingClientRect: () => DOMRect.fromRect({ x: spot.x, y: spot.y, width: 0, height: 0 }),
  };
  return (
    <Popover.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={0} className="z-(--z-menu)">
          <Popover.Popup initialFocus={cancel} className={cn(POPUP, "w-80")}>
            {spec && (
              <div className="flex flex-col gap-2.5 px-2 pt-2 pb-1.5">
                <Popover.Title className="m-0 text-base font-bold">{spec.title}</Popover.Title>
                <Popover.Description className="m-0 text-sm text-fg-muted">{spec.text}</Popover.Description>
                <div className="flex justify-end gap-2">
                  <Button ref={cancel} size="sm" onClick={onClose}>
                    {t("Cancel")}
                  </Button>
                  <Button
                    size="sm"
                    variant="solidDanger"
                    icon={spec.confirmIcon}
                    onClick={() => {
                      onClose();
                      spec.onConfirm();
                    }}
                  >
                    {spec.confirmLabel}
                  </Button>
                </div>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Estado comum dos dois menus: aberto, confirmação pendente e onde ela abre. */
function useMenuState() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  useOverlay(open);
  const ask = (c: ConfirmSpec) => {
    const r = popup.current?.getBoundingClientRect();
    setSpot(r ? { x: r.left, y: r.top } : { x: 0, y: 0 });
    setConfirm(c);
  };
  const close = () => {
    setConfirm(null);
    setSpot(null);
  };
  return { open, setOpen, confirm, spot, popup, ask, close };
}

interface MenuButtonProps {
  /** O botão que abre (ex.: <IconButton icon={Ellipsis} label=… />); recebe aria-haspopup/expanded da Base UI. */
  trigger: ReactElement;
  items: MenuEntry[];
  label: string;
}

/** Menu que abre num botão. */
export function MenuButton({ trigger, items, label }: MenuButtonProps) {
  const { open, setOpen, confirm, spot, popup, ask, close } = useMenuState();
  return (
    <>
      <BaseMenu.Root open={open} onOpenChange={setOpen}>
        <BaseMenu.Trigger render={trigger} />
        <BaseMenu.Portal>
          <BaseMenu.Positioner side="bottom" align="start" sideOffset={4} className="z-(--z-menu)">
            <BaseMenu.Popup ref={popup} aria-label={label} className={POPUP}>
              <Entries items={items} onConfirm={ask} />
            </BaseMenu.Popup>
          </BaseMenu.Positioner>
        </BaseMenu.Portal>
      </BaseMenu.Root>
      <Confirm spec={confirm} spot={spot} onClose={close} />
    </>
  );
}

interface ContextMenuAreaProps {
  children: ReactNode;
  items: MenuEntry[] | (() => MenuEntry[]);
  label: string;
  className?: string;
}

/** Menu de botão direito sobre `children` (abre onde o mouse estava). */
export function ContextMenuArea({ children, items, label, className }: ContextMenuAreaProps) {
  const { open, setOpen, confirm, spot, popup, ask, close } = useMenuState();
  const list = typeof items === "function" ? items : () => items;
  return (
    <>
      <ContextMenu.Root open={open} onOpenChange={setOpen}>
        <ContextMenu.Trigger className={className}>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="z-(--z-menu)">
            <ContextMenu.Popup ref={popup} aria-label={label} className={POPUP}>
              {open && <Entries items={list()} onConfirm={ask} />}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <Confirm spec={confirm} spot={spot} onClose={close} />
    </>
  );
}
