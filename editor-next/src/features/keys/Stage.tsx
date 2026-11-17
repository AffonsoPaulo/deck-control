// O palco da seção Teclas: em cima as abas das páginas e Normal/Ativas, no meio o Deck, embaixo "Mostrar no
// Deck" e se é a página inicial. As abas que não cabem vão para o menu "+N" (a aberta fica sempre à mostra);
// criar, renomear e o menu da página chegam depois.
import { ChevronDown, House, MonitorCheck, MonitorUp } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { MenuButton } from "@/components/Menu";
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
import { Problems } from "@/features/keys/Problems";
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

const TAB =
  "inline-flex h-control-md flex-none cursor-pointer items-center gap-2 rounded-md px-3.5 text-base font-semibold whitespace-nowrap transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-accent";
const TAB_STATE =
  "data-current:bg-selected data-current:text-fg not-data-current:text-fg-muted not-data-current:hover:bg-tint-hover not-data-current:hover:text-fg";
const GAP = 2; // gap-0.5 entre as abas
const PAD = 6; // p-0.75 dos dois lados do trilho

/** Quais abas cabem: as que couberem em ordem; a aberta sempre fica (tira do fim até caber). Mesma regra do
 * fitPages do editor atual. `widths`: a largura de cada aba; `more`: a do botão "+N". */
export function fitTabs(names: string[], widths: number[], avail: number, more: number, current: string): string[] {
  const w = (i: number) => (widths[i] ?? 0) + GAP;
  const total = names.reduce((sum, _n, i) => sum + w(i), 0);
  if (total + PAD <= avail) return names;
  const room = avail - PAD - (more + GAP);
  const visible: number[] = [];
  let used = 0;
  for (let i = 0; i < names.length; i++) {
    if (used + w(i) > room) break;
    used += w(i);
    visible.push(i);
  }
  const cur = names.indexOf(current);
  if (cur >= 0 && !visible.includes(cur)) {
    while (visible.length && used + w(cur) > room) used -= w(visible.pop() as number);
    visible.push(cur);
  }
  return names.filter((_n, i) => visible.includes(i));
}

function PageTabs({ current }: { current: string }) {
  const t = useT();
  const names = useConfig((s) => Object.keys(pagesOf(s.cfg)).join("\n"))
    .split("\n")
    .filter(Boolean);
  const home = useConfig((s) => s.cfg?.home);
  const go = useUi((s) => s.go);
  const box = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<string[] | null>(null);
  const key = names.join("\n");

  // mede as abas numa fileira invisível e decide quais cabem (de novo quando a coluna muda de largura)
  useLayoutEffect(() => {
    const el = box.current;
    const r = ruler.current;
    if (!el || !r) return;
    const fit = () => {
      const kids = [...r.children] as HTMLElement[];
      const widths = kids.slice(0, -1).map((k) => k.offsetWidth);
      const more = kids.at(-1)?.offsetWidth ?? 60;
      setShown(fitTabs(key.split("\n").filter(Boolean), widths, el.clientWidth, more, current));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key, current]);

  const visible = shown ?? names;
  const rest = names.filter((n) => !visible.includes(n));
  const tab = (name: string) => (
    <button
      key={name}
      type="button"
      aria-current={name === current ? "page" : undefined}
      data-current={name === current || undefined}
      title={name === home ? t("Home page. ").trim() : undefined}
      onClick={() => name !== current && go({ page: name, key: null })}
      className={cn(TAB, TAB_STATE)}
    >
      {name}
    </button>
  );
  return (
    <div ref={box} className="relative min-w-0 flex-1">
      {/* fileira invisível só para medir (todas as abas e o "+00") */}
      <div ref={ruler} aria-hidden className="pointer-events-none invisible absolute flex gap-0.5">
        {names.map((n) => (
          <span key={n} className={TAB}>
            {n}
          </span>
        ))}
        <span className={cn(TAB, "gap-1.5")}>
          +00
          <Icon icon={ChevronDown} size="sm" />
        </span>
      </div>
      <nav aria-label={t("Pages")} className="inline-flex max-w-full items-center gap-0.5 overflow-hidden rounded-lg bg-sunken p-0.75">
        {visible.map(tab)}
        {rest.length > 0 && (
          <MenuButton
            label={t("Other pages")}
            items={rest.map((name) => ({ label: name, onSelect: () => go({ page: name, key: null }) }))}
            trigger={
              <button type="button" title={t("Other pages")} className={cn(TAB, "gap-1.5 text-fg-muted hover:bg-tint-hover hover:text-fg")}>
                +{rest.length}
                <Icon icon={ChevronDown} size="sm" />
              </button>
            }
          />
        )}
      </nav>
    </div>
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
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto px-7 py-8 scrollbar-stable-both">
      <div className="mb-4.5 flex w-full max-w-150 items-center gap-3">
        <PageTabs current={page} />
        <div className="flex-none">
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
      <Problems />
    </main>
  );
}
