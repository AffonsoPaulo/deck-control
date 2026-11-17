// O palco da seção Teclas: em cima as abas das páginas e Normal/Ativas, no meio o Deck, embaixo "Mostrar no
// Deck" e se é a página inicial. As abas que não cabem vão para o menu "+N" (a aberta fica sempre à mostra).
// Criar ("+ Página"), renomear (clique duplo), o menu da página ("…" e botão direito) e soltar uma tecla numa
// aba para levá-la para aquela página, como no editor atual.
import { useDroppable } from "@dnd-kit/react";
import { ChevronDown, Ellipsis, House, MonitorCheck, MonitorUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { ContextMenuArea, MenuButton, type MenuEntry } from "@/components/Menu";
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
import { pagesOf } from "@/features/keys/model";
import { addPage, deletePage, renamePage, setHome, useRenaming } from "@/features/keys/pageOps";

/** A página aberta, sempre uma que existe (a da URL, a inicial ou a primeira). */
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
      const add = (kids.at(-2)?.offsetWidth ?? 0) + GAP; // o "+ Página" fica sempre
      setShown(fitTabs(key.split("\n").filter(Boolean), widths.slice(0, -1), el.clientWidth - add, more, current));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key, current]);

  const visible = shown ?? names;
  const rest = names.filter((n) => !visible.includes(n));
  const tab = (name: string) => <PageTab key={name} name={name} current={current} home={home === name} />;
  return (
    <div ref={box} className="relative min-w-0 flex-1">
      {/* fileira invisível só para medir (todas as abas e o "+00") */}
      <div ref={ruler} aria-hidden className="pointer-events-none invisible absolute flex gap-0.5">
        {names.map((n) => (
          <span key={n} className={TAB}>
            {n}
          </span>
        ))}
        <span className={cn(TAB, "px-2.5 font-medium")}>
          <Icon icon={Plus} size="xs" />
          {t("Page")}
        </span>
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
        <button type="button" title={t("Create page")} onClick={() => addPage(t)} className={cn(TAB, "px-2.5 font-medium text-fg-subtle hover:bg-tint-hover hover:text-fg")}>
          <Icon icon={Plus} size="xs" />
          {t("Page")}
        </button>
      </nav>
    </div>
  );
}

/** Os itens do menu de uma página (o "…" e o botão direito na aba). */
function usePageMenu(name: string): () => MenuEntry[] {
  const t = useT();
  return () => {
    const cfg = useConfig.getState().cfg;
    const pages = pagesOf(cfg);
    const n = Object.keys(pages[name] ?? {}).length;
    const del: MenuEntry = {
      label: t("Delete page…"),
      icon: Trash2,
      danger: true,
      disabled: Object.keys(pages).length < 2,
      // página com teclas: confirma; vazia sai direto
      ...(n
        ? {
            confirm: {
              title: t('Delete page "{0}"?', [name]),
              text: n === 1 ? t("Its 1 key goes with it. You can undo right after, or from the history.") : t("Its {0} keys go with it. You can undo right after, or from the history.", [n]),
              confirmLabel: t("Delete page"),
              confirmIcon: Trash2,
              onConfirm: () => deletePage(t, name),
            },
          }
        : { onSelect: () => deletePage(t, name) }),
    };
    return [
      { type: "head", label: t("Page {0}", [name]) },
      { label: t("Rename"), icon: Pencil, onSelect: () => startRename(name) },
      { label: t("Use as home page"), icon: House, disabled: cfg?.home === name, onSelect: () => setHome(name) },
      { label: t("Show on Deck"), icon: MonitorUp, onSelect: () => void showOnDeck(t, name) },
      { type: "separator" },
      del,
    ];
  };
}

function startRename(name: string) {
  if (useUi.getState().page !== name) useUi.getState().go({ page: name, key: null });
  useRenaming.setState({ name });
}

function PageTab({ name, current, home }: { name: string; current: string; home: boolean }) {
  const t = useT();
  const go = useUi((s) => s.go);
  const renaming = useRenaming((s) => s.name === name);
  const menu = usePageMenu(name);
  // soltar uma tecla aqui leva ela para esta página
  const { ref, isDropTarget } = useDroppable({ id: `page|${name}`, disabled: name === current });
  if (renaming) return <RenameInput name={name} />;
  return (
    <ContextMenuArea items={menu} label={t("Page options")} className="contents">
      <button
        ref={ref}
        type="button"
        aria-current={name === current ? "page" : undefined}
        data-current={name === current || undefined}
        title={(home ? t("Home page. ") : "") + t("Double-click to rename")}
        onClick={() => name !== current && go({ page: name, key: null })}
        onDoubleClick={() => startRename(name)}
        className={cn(TAB, TAB_STATE, isDropTarget && "inset-ring-2 inset-ring-accent")}
      >
        {name}
      </button>
    </ContextMenuArea>
  );
}

function RenameInput({ name }: { name: string }) {
  const t = useT();
  const [v, setV] = useState(name);
  const done = useRef(false);
  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    if (ok) renamePage(t, name, v);
    else useRenaming.setState({ name: null });
  };
  return (
    <input
      type="text"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      value={v}
      size={Math.max(4, v.length + 1)}
      aria-label={t("New page name")}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      className="h-control-md w-auto rounded-md border border-fg bg-surface px-2.5 text-base font-semibold text-fg ring-3 ring-accent-ring outline-none"
    />
  );
}

async function showOnDeck(t: (s: string, a?: unknown[]) => string, page: string) {
  if (!(await flushSave())) return toast(t("Fix the errors first: the page hasn't been saved yet."), { bad: true });
  await new Promise((r) => setTimeout(r, 1200)); // o app relê o config em até 1 s
  try {
    await api("POST /api/show", { page });
    toast(t("Showing {0} on the Deck.", [page]));
  } catch (e) {
    toast((e as Error).message, { bad: true });
  }
}

function PageMenuButton({ page }: { page: string }) {
  const t = useT();
  const menu = usePageMenu(page);
  return <MenuButton label={t("Page options")} items={menu()} trigger={<IconButton icon={Ellipsis} size="sm" label={t("Page options")} title={t("Page options")} />} />;
}


function StageBar({ page }: { page: string }) {
  const t = useT();
  const status = useStatus();
  const isHome = useConfig((s) => s.cfg?.home === page);
  const onDeck = status.engine && status.page === page;
  const show = () => showOnDeck(t, page);
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
        <PageMenuButton page={page} />
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
