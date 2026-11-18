// Topo: nome da seção, estado (Deck, OBS, salvo) e desfazer, refazer e histórico de versões.
import { History, Redo2, Undo2 } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { useT } from "@/core/i18n";
import type { Status } from "@/core/queries";
import type { SaveState } from "@/core/store/config";
import { useState } from "react";
import { useUi } from "@/core/store/ui";
import { HistorySheet } from "@/app/History";
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
  showLogsTab: boolean;
}

export function TopBar({ title, status, showObs, saveState, canUndo, canRedo, onUndo, onRedo, showLogsTab }: TopBarProps) {
  const t = useT();
  const [history, setHistory] = useState(false);
  return (
    <header className="sticky top-0 z-(--z-sticky) flex h-top flex-none items-center gap-3.5 border-b border-border bg-surface pr-4 pl-4.5">
      <h1 className="m-0 text-lg font-bold">{title}</h1>
      <div className="flex-1" />
      <StatusGroup
        status={status}
        showObs={showObs}
        saveState={saveState}
        showLogsTab={showLogsTab}
        onSaveErrorClick={() => {
          // o que impede salvar fica no painel embaixo do Deck
          useUi.getState().go({ section: "keys", expanded: false });
          requestAnimationFrame(() => document.getElementById("problems")?.scrollIntoView({ block: "center", behavior: "smooth" }));
        }}
      />
      <div className="flex items-center gap-1">
        <IconButton icon={Undo2} label={t("Undo")} title={t("Undo (Ctrl+Z)")} disabled={!canUndo} onClick={onUndo} />
        <IconButton icon={Redo2} label={t("Redo")} title={t("Redo (Ctrl+Y)")} disabled={!canRedo} onClick={onRedo} />
        <IconButton icon={History} label={t("Version history")} title={t("Version history")} onClick={() => setHistory(true)} />
        <HistorySheet open={history} onOpenChange={setHistory} />
      </div>
    </header>
  );
}
