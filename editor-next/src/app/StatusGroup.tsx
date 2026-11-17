// Grupo de estado do topo: o Deck (e o OBS, se ligado) e se está tudo salvo. Cada parte com ícone e texto;
// cor só quando precisa de atenção (como no editor atual).
import { Check, CircleAlert, Radio, RefreshCw, Usb, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import type { Status } from "@/core/queries";
import type { SaveState } from "@/core/store/config";

interface ItemProps {
  icon: LucideIcon;
  name?: string;
  state: string;
  bad?: boolean;
  title: string;
  first?: boolean;
  onClick?: () => void;
}

function Item({ icon, name, state, bad = false, title, first = false, onClick }: ItemProps) {
  return (
    <span
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-5.5 items-center gap-2 px-3",
        !first && "border-l border-border-strong",
        onClick && "cursor-pointer",
      )}
    >
      <Icon icon={icon} className={bad ? "text-danger-fg" : "text-fg-muted"} />
      {name && <b className="font-semibold text-fg">{name}</b>}
      <span className={bad ? "text-danger-fg" : "text-fg-subtle"}>{state}</span>
    </span>
  );
}

interface StatusGroupProps {
  status: Status;
  showObs: boolean;
  saveState: SaveState;
  onSaveErrorClick?: () => void;
}

export function StatusGroup({ status, showObs, saveState, onSaveErrorClick }: StatusGroupProps) {
  const t = useT();
  const save: Record<SaveState, [LucideIcon, string, string]> = {
    saved: [Check, t("Saved"), t("All saved. The Deck already has this version.")],
    pending: [RefreshCw, t("Saving…"), ""],
    saving: [RefreshCw, t("Saving…"), ""],
    error: [CircleAlert, t("Not saved"), t("Click to see what needs fixing")],
  };
  const [saveIcon, saveText, saveTitle] = save[saveState];
  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex h-control-lg items-center rounded-md border border-border bg-sunken px-0.5 text-sm whitespace-nowrap text-fg-muted"
    >
      {status.engine ? (
        <>
          <Item
            first
            icon={Usb}
            name="Deck"
            state={status.device ? t("connected") : t("disconnected")}
            bad={!status.device}
            title={status.device ? t("The Deck is connected.") : t("Check the Deck USB cable.")}
          />
          {showObs && (
            <Item
              icon={Radio}
              name="OBS"
              state={status.obs ? t("connected") : t("closed")}
              title={status.obs ? t("Connected to OBS.") : t("The app connects on its own when OBS opens.")}
            />
          )}
        </>
      ) : (
        <Item
          first
          icon={Usb}
          name="Deck"
          state={t("app closed")}
          bad
          title={t("The Deck app is not running: you can edit, but the Deck won't update.")}
        />
      )}
      <Item
        icon={saveIcon}
        state={saveText}
        bad={saveState === "error"}
        title={saveTitle}
        {...(saveState === "error" && onSaveErrorClick ? { onClick: onSaveErrorClick } : {})}
      />
    </div>
  );
}
