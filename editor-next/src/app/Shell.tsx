// A casca do editor: trilho, topo e a seção aberta. Liga o estado (config, lugar, estado do app) aos componentes.
import { lazy, Suspense, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import favOff from "deck-static/favicon-off.svg?url";
import favOn from "deck-static/favicon.svg?url";
import type { Section } from "@/core/hash";
import { useT } from "@/core/i18n";
import { useStatus } from "@/core/queries";
import { flushSave } from "@/core/store/autosave";
import { anyOverlayOpen } from "@/core/overlay";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { useValidation } from "@/core/validation";
import { Rail } from "@/app/Rail";
import { SectionPlaceholder } from "@/app/SectionPlaceholder";
import { TopBar } from "@/app/TopBar";
import { Toaster } from "@/components/Toaster";

// cada seção num pedaço próprio do build: só carrega quando abre
const KeysSection = lazy(() => import("@/features/keys/KeysSection").then((m) => ({ default: m.KeysSection })));
const AutoSection = lazy(() => import("@/features/auto/AutoSection").then((m) => ({ default: m.AutoSection })));
const LogsSection = lazy(() => import("@/features/logs/LogsSection").then((m) => ({ default: m.LogsSection })));
const LightSection = lazy(() => import("@/features/light/LightSection").then((m) => ({ default: m.LightSection })));

const TITLES: Record<Section, string> = {
  keys: "Keys",
  light: "Light",
  auto: "Automations",
  logs: "Logs",
  settings: "Settings",
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function Shell() {
  const t = useT();
  const status = useStatus();
  const place = useUi();
  const cfg = useConfig((s) => s.cfg);
  const saveState = useConfig((s) => s.saveState);
  const canUndo = useConfig((s) => s.past.length > 0);
  const canRedo = useConfig((s) => s.future.length > 0);
  const { undo, redo } = useConfig.getState();
  useValidation();

  const logging = isObj(cfg?.logging) ? cfg.logging : {};
  const showLogs = !!logging.show_tab;
  const showObs = isObj(cfg?.obs) && cfg.obs.enabled !== false;
  const connected = status.engine && status.device;
  const brand = connected ? favOn : favOff;

  // marca e favicon: tecla acesa = Deck conectado (igual ao ícone da bandeja)
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>("link[rel=icon]");
    if (link && link.getAttribute("href") !== brand) link.setAttribute("href", brand);
  }, [brand]);

  // a aba de Logs escondida não pode ficar aberta
  const section = place.section === "logs" && !showLogs ? "keys" : place.section;

  // mesmos atalhos do editor atual: Ctrl+S grava na hora (até digitando); desfazer/refazer fora dos campos
  useHotkeys("mod+s", (e) => {
    e.preventDefault();
    void flushSave();
  }, { enableOnFormTags: true });
  // com menu, confirmação ou diálogo aberto, desfazer/refazer ficam quietos (como no editor atual)
  const free = () => !anyOverlayOpen();
  useHotkeys("mod+z", (e) => {
    e.preventDefault();
    undo();
  }, { enabled: free });
  useHotkeys(["mod+y", "mod+shift+z"], (e) => {
    e.preventDefault();
    redo();
  }, { enabled: free });

  return (
    <div className="flex h-dvh bg-canvas text-fg">
      <Rail current={section} showLogs={showLogs} brand={brand} onSelect={(s) => place.go({ section: s })} newErrors={status.logs.new_errors} />
      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        <TopBar
          title={t(TITLES[section])}
          status={status}
          showObs={showObs}
          showLogsTab={showLogs}
          saveState={saveState}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
        />
        <Suspense>
          {section === "keys" ? <KeysSection /> : section === "light" ? <LightSection /> : section === "auto" ? <AutoSection /> : section === "logs" ? <LogsSection /> : <SectionPlaceholder place={{ ...place, section }} />}
        </Suspense>
      </div>
      <Toaster />
    </div>
  );
}
