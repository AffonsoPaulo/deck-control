// Topo: nome da seção, estado (Deck, OBS, salvo) e desfazer, refazer e histórico de versões.
import { History, Redo2, Undo2 } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { useT } from "@/core/i18n";
import type { Status } from "@/core/queries";
import type { SaveState } from "@/core/store/config";
import { StatusGroup } from "@/app/StatusGroup";

interface TopBarProps {
  title: string;
  status: Status;
  showObs: boolean;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function TopBar({ title, status, showObs, saveState, canUndo, canRedo, onUndo, onRedo }: TopBarProps) {
  const t = useT();
  return (
    <header className="sticky top-0 z-(--z-sticky) flex h-top flex-none items-center gap-3.5 border-b border-border bg-surface pr-4 pl-4.5">
      <h1 className="m-0 text-lg font-bold">{title}</h1>
      <div className="flex-1" />
      <StatusGroup status={status} showObs={showObs} saveState={saveState} />
      <div className="flex items-center gap-1">
        <IconButton icon={Undo2} label={t("Undo")} title={t("Undo (Ctrl+Z)")} disabled={!canUndo} onClick={onUndo} />
        <IconButton icon={Redo2} label={t("Redo")} title={t("Redo (Ctrl+Y)")} disabled={!canRedo} onClick={onRedo} />
        {/* o histórico de versões chega com a Fase 4 do editor novo */}
        <IconButton icon={History} label={t("Version history")} title={`${t("Version history")} (${t("Coming soon")})`} disabled />
      </div>
    </header>
  );
}
