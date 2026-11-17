// O palco da seção Teclas: em cima as abas das páginas e Normal/Ativas, no meio o Deck, embaixo "Mostrar no
// Deck" e se é a página inicial. Nesta parte as abas só trocam de página (criar, renomear, menu e o "+N" das
// que não cabem chegam depois).
import { House, MonitorCheck, MonitorUp } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { api } from "@/core/api";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import { useStatus } from "@/core/queries";
import { flushSave } from "@/core/store/autosave";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { toast } from "@/core/toast";
import { DeckGrid } from "@/features/keys/DeckGrid";
import { initialPage, pagesOf } from "@/features/keys/model";

/** A página aberta, sempre uma que existe (a da URL, a inicial ou a primeira). */
export function useCurrentPage(): string | null {
  const cfg = useConfig((s) => s.cfg);
  const page = useUi((s) => s.page);
  const go = useUi((s) => s.go);
  const valid = initialPage(cfg, page);
  useEffect(() => {
    if (valid !== page) go({ page: valid, key: null });
  }, [valid, page, go]);
  return valid;
}

function PageTabs({ current }: { current: string }) {
  const t = useT();
  const names = useConfig((s) => Object.keys(pagesOf(s.cfg)).join("\n"));
  const home = useConfig((s) => s.cfg?.home);
  const go = useUi((s) => s.go);
  return (
    <nav aria-label={t("Pages")} className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg bg-sunken p-0.75">
      {names.split("\n").filter(Boolean).map((name) => (
        <button
          key={name}
          type="button"
          aria-current={name === current ? "page" : undefined}
          data-current={name === current || undefined}
          title={name === home ? t("Home page. ").trim() : undefined}
          onClick={() => name !== current && go({ page: name, key: null })}
          className={cn(
            "inline-flex h-control-md flex-none cursor-pointer items-center gap-2 rounded-md px-3.5 text-base font-semibold whitespace-nowrap",
            "transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-accent",
            "data-current:bg-selected data-current:text-fg not-data-current:text-fg-muted not-data-current:hover:bg-tint-hover not-data-current:hover:text-fg",
          )}
        >
          {name}
        </button>
      ))}
    </nav>
  );
}

function StageBar({ page }: { page: string }) {
  const t = useT();
  const status = useStatus();
  const isHome = useConfig((s) => s.cfg?.home === page);
  const onDeck = status.engine && status.page === page;
  const show = async () => {
    if (!(await flushSave())) return toast(t("Fix the errors first: the page hasn't been saved yet."), { bad: true });
    await new Promise((r) => setTimeout(r, 1200)); // o app relê o config em até 1 s
    try {
      await api("POST /api/show", { page });
      toast(t("Showing {0} on the Deck.", [page]));
    } catch (e) {
      toast((e as Error).message, { bad: true });
    }
  };
  const fact = "inline-flex h-control-md items-center gap-2 px-2.5 text-sm font-medium text-fg-subtle";
  return (
    <div className="mt-4.5 flex w-full max-w-150 flex-wrap items-center gap-1">
      {onDeck ? (
        <span className={fact}>
          <Icon icon={MonitorCheck} size="sm" />
          {t("Showing on the Deck")}
        </span>
      ) : (
        <Button size="sm" variant="ghost" icon={MonitorUp} title={t("Show this page on the Deck")} onClick={() => void show()}>
          {t("Show on Deck")}
        </Button>
      )}
      {isHome && (
        <span className={fact}>
          <Icon icon={House} size="sm" />
          {t("Home page")}
        </span>
      )}
    </div>
  );
}

export function Stage({ page }: { page: string }) {
  const t = useT();
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto px-7 py-8">
      <div className="mb-4.5 flex w-full max-w-150 items-center gap-3">
        <PageTabs current={page} />
        <div className="ml-auto">
          <Segmented
            label={t("Show keys")}
            value={view}
            onChange={(v) => go({ view: v })}
            options={[
              { value: "normal", label: t("Normal") },
              { value: "active", label: t("Active") },
            ]}
          />
        </div>
      </div>
      <DeckGrid page={page} />
      <StageBar page={page} />
    </main>
  );
}
