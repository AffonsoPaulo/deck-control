// A biblioteca (coluna da esquerda da seção Teclas): busca, as abas Ações e Widgets, os grupos em sanfona e as
// peças que se arrastam para o Deck (ou que vão para a tecla escolhida com um clique). Mesmo desenho e regras do
// editor atual (renderLibrary, infoLibraryGroups, widgetLibrary, widgetItem).
import { LayoutGrid, Plug, Search, X, Zap } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { IconButton } from "@/components/IconButton";
import { Icon } from "@/components/Icon";
import { useLucideIndex } from "@/components/IconPicker";
import { TextInput } from "@/components/Field";
import { Chip, LibGroup, LibSub, SizeTile, catStyle, type Origin } from "@/components/Library";
import { Select } from "@/components/Select";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import { luChar, norm } from "@/core/icons/lucide";
import { useSchema } from "@/core/queries";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { toast } from "@/core/toast";
import { actionDefs, groupOf, groupedActions, groupsOf, iconOf, savedKeys, sizeColsRows, widgetDefs, type ActionDef } from "@/features/keys/actions";
import { useLibDrag } from "@/features/keys/dnd";
import { useLib } from "@/features/keys/libStore";
import { spanOf, type DragPayload } from "@/features/keys/model";
import { usePlacer } from "@/features/keys/place";
import { useThumbs, type ThumbItem } from "@/features/keys/thumbs";
import { isObj, type Obj } from "@/core/obj";

const ITEM =
  "flex w-full cursor-grab items-center gap-3 rounded-md px-2 py-1.75 text-left hover:bg-sunken active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent";

export function LibraryPanel({ page }: { page: string }) {
  const t = useT();
  const tab = useLib((s) => s.tab);
  const setTab = useLib((s) => s.setTab);
  const [query, setQuery] = useState("");
  const counts = useCounts(query);
  const tabs: [typeof tab, typeof Zap, string, number | null][] = [
    ["actions", Zap, t("Actions"), counts.actions],
    ["widgets", LayoutGrid, t("Widgets"), counts.widgets],
  ];
  const placeholder = tab === "widgets" ? t("Search widgets") : t("Search actions");
  return (
    <aside aria-label={t("Actions")} className="flex min-h-0 w-67 flex-none flex-col border-r border-border bg-surface">
      <div className="relative px-3.5 pt-3.5 pb-2">
        <Icon icon={Search} size="sm" className="pointer-events-none absolute top-6.25 left-6.25 text-fg-subtle" />
        <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="border-transparent pl-8.5" />
      </div>
      <div role="tablist" className="mx-3.5 mb-1.5 flex gap-0.5 rounded-lg bg-sunken p-0.75">
        {tabs.map(([id, icon, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="group inline-flex h-control-md flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-semibold text-fg-muted transition-colors duration-(--duration-fast) not-aria-selected:hover:bg-tint-hover not-aria-selected:hover:text-fg aria-selected:bg-selected aria-selected:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon icon={icon} />
            {label}
            {n !== null && <span className="text-xs font-medium text-fg-subtle group-aria-selected:text-fg-muted">{n}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2.5 pt-1 pb-3 scrollbar-stable">{tab === "widgets" ? <WidgetsTab query={query} page={page} /> : <ActionsTab query={query} page={page} />}</div>
      <p className="m-0 border-t border-border px-4.5 pt-3 pb-4 text-xs text-fg-subtle">
        {tab === "widgets" ? t("Drag a widget onto the Deck. Click it to see the sizes.") : t("Drag an action onto a Deck key, or into the list of steps.")}
      </p>
    </aside>
  );
}

/** Buscando, cada aba mostra quantos resultados tem. */
function useCounts(query: string): { actions: number | null; widgets: number | null } {
  const t = useT();
  const schema = useSchema().data;
  const cfg = useConfig((s) => s.cfg);
  return useMemo(() => {
    if (!query) return { actions: null, widgets: null };
    const nq = norm(query);
    const actions = groupedActions(actionDefs(schema), groupsOf(schema), nq, norm, t).reduce((n, [, items]) => n + items.length, 0);
    const widgets = Object.entries(widgetDefs(schema, cfg)).filter(([id, d]) => widgetMatches(id, d, nq, schema, t)).length;
    return { actions, widgets };
  }, [query, schema, cfg, t]);
}

// ---------------------------------------------------------------------------- aba Ações

function ActionsTab({ query, page }: { query: string; page: string }) {
  const t = useT();
  const schema = useSchema().data;
  const cfg = useConfig((s) => s.cfg);
  const open = useLib((s) => s.open);
  const toggle = useLib((s) => s.toggle);
  const defs = actionDefs(schema);
  const groups = groupsOf(schema);
  const nq = norm(query);
  const list = groupedActions(defs, groups, nq, norm, t);
  const saved = savedKeys(cfg)
    .map((it, i) => [it, i] as const)
    .filter(([it]) => !nq || norm(it.name).includes(nq));
  const isOpen = (g: string) => !!query || open.includes(g);
  if (!list.length && !saved.length) return <p className="mt-3 mb-0 px-2 text-xs text-fg-subtle">{t("No actions found.")}</p>;
  return (
    <>
      {list.map(([g, items]) => (
        <LibGroup key={g.name} label={t(g.name)} color={g.color} count={items.length} open={isOpen(g.name)} onToggle={() => toggle(g.name)}>
          {items.map(([type, d]) => (
            <ActionItem key={type} type={type} def={d} color={groupOf(groups, defs, type).color} page={page} />
          ))}
        </LibGroup>
      ))}
      {saved.length > 0 && (
        <LibGroup label={t("Saved keys")} color="var(--fg-muted)" count={saved.length} open={isOpen("Saved keys")} onToggle={() => toggle("Saved keys")}>
          {saved.map(([it, i]) => (
            <SavedItem key={i} index={i} name={it.name} spec={it.key} />
          ))}
        </LibGroup>
      )}
    </>
  );
}

function ActionItem({ type, def, color, page }: { type: string; def: ActionDef; color: string; page: string }) {
  const t = useT();
  const idx = useLucideIndex();
  const schema = useSchema().data;
  const placer = usePlacer(page);
  const label = t(def.label);
  const payload = useMemo<DragPayload>(() => ({ kind: "new", type, label }), [type, label]);
  const { ref } = useLibDrag(`a:${type}`, payload);
  return (
    <button
      ref={ref}
      type="button"
      title={def.help ? t(def.help) : label}
      style={catStyle(color)}
      className={ITEM}
      onClick={() => {
        const k = useUi.getState().key;
        if (!k) return toast(t("Click a key first, or drag the action onto it."));
        void placer.assign(k, type);
      }}
    >
      <Chip glyph={idx ? luChar(idx, iconOf(actionDefs(schema), type)) : ""} />
      <span className="font-medium">{label}</span>
    </button>
  );
}

function SavedItem({ index, name, spec }: { index: number; name: string; spec: Obj }) {
  const t = useT();
  const idx = useLucideIndex();
  const edit = useConfig((s) => s.edit);
  const [cols, rows] = spanOf(spec);
  const icon = typeof spec.icon === "string" ? { text: spec.icon } : isObj(spec.icon) ? spec.icon : {};
  const payload = useMemo<DragPayload>(() => ({ kind: "saved", index, label: name, cols, rows }), [index, name, cols, rows]);
  const { ref } = useLibDrag(`s:${index}`, payload);
  const lucide = typeof icon.lucide === "string" && !/\{[^}]+\}/.test(icon.lucide) ? icon.lucide : null;
  const bg = typeof icon.bg === "string" ? icon.bg : "#1d2330";
  return (
    <div ref={ref} title={t("Drag onto the keys to use it again")} className={cn(ITEM, "group")}>
      <span aria-hidden className="grid size-7.5 flex-none place-items-center rounded-sm text-key-fg" style={{ background: bg }}>
        {lucide && idx ? <span className="font-lucide text-(length:--icon-md) leading-none">{luChar(idx, lucide)}</span> : <Icon icon={LayoutGrid} />}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      {cols * rows > 1 && <Tag>{`${rows}×${cols}`}</Tag>}
      <IconButton
        icon={X}
        size="sm"
        label={t("Remove from saved keys")}
        onClick={(e) => {
          e.stopPropagation();
          edit((d) => {
            const list = d.saved_keys as unknown[];
            list.splice(index, 1);
            if (!list.length) delete d.saved_keys;
          });
        }}
      />
    </div>
  );
}

/** Etiqueta pequena (tamanho da tecla guardada; nome do plugin). */
function Tag({ children, onClick, title }: { children: ReactNode; onClick?: () => void; title?: string }) {
  const base = "ml-auto inline-flex h-5 flex-none items-center gap-1 rounded-sm px-1.75 text-2xs font-semibold text-fg-muted";
  if (!onClick) return <span className={cn(base, "bg-border")}>{children}</span>;
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(base, "cursor-pointer inset-ring inset-ring-border-strong hover:bg-sunken hover:text-fg")}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------- aba Widgets

const widgetOrigin = (d: Obj): string => (d.mine ? "mine" : typeof d.plugin === "string" && d.plugin ? d.plugin : "app");

function useOriginName() {
  const t = useT();
  const schema = useSchema().data;
  return (o: string) => {
    if (o === "app") return t("App");
    if (o === "mine") return t("My widgets");
    const p = (schema?.plugins ?? []).find((x) => (x as Obj).id === o) as Obj | undefined;
    return typeof p?.name === "string" ? p.name : o;
  };
}

function widgetMatches(id: string, d: Obj, nq: string, schema: ReturnType<typeof useSchema>["data"], t: ReturnType<typeof useT>): boolean {
  if (!nq) return true;
  const cat = schema?.widget_categories.find((c) => c.id === d.category);
  const o = widgetOrigin(d);
  const pluginName = (schema?.plugins ?? []).find((x) => (x as Obj).id === o) as Obj | undefined;
  const oname = o === "app" ? t("App") : o === "mine" ? t("My widgets") : String(pluginName?.name ?? o);
  return norm(`${String(d.label)} ${id} ${cat ? t(cat.label) : ""} ${oname}`).includes(nq);
}

function WidgetsTab({ query, page }: { query: string; page: string }) {
  const t = useT();
  const schema = useSchema().data;
  const cfg = useConfig((s) => s.cfg);
  const open = useLib((s) => s.open);
  const toggle = useLib((s) => s.toggle);
  const origin = useLib((s) => s.origin);
  const setOrigin = useLib((s) => s.setOrigin);
  const originName = useOriginName();
  const nq = norm(query);
  const defs = Object.entries(widgetDefs(schema, cfg));
  const counts: Record<string, number> = {};
  for (const [, d] of defs) counts[widgetOrigin(d)] = (counts[widgetOrigin(d)] ?? 0) + 1;
  const plugins = Object.keys(counts)
    .filter((o) => o !== "app" && o !== "mine")
    .sort((a, b) => originName(a).localeCompare(originName(b)));
  const current = origin !== "all" && !counts[origin] ? "all" : origin;
  const cats = [...(schema?.widget_categories ?? []), { id: "mine", label: "My widgets", color: "var(--fg-muted)" }];
  const shown = defs.filter(([id, d]) => (current === "all" || widgetOrigin(d) === current) && widgetMatches(id, d, nq, schema, t));
  const rank = (o: string) => (o === "app" ? "0" : o === "mine" ? "2" : "1" + originName(o).toLowerCase());

  return (
    <>
      <div className="flex items-center gap-2 px-2 pt-0.5 pb-1.5 text-sm text-fg-subtle">
        <span>{t("Origin")}</span>
        <Select
          aria-label={t("Origin")}
          size="sm"
          value={current}
          onChange={setOrigin}
          className="min-w-0 flex-1"
          options={[
            { value: "all", label: `${t("All origins")} (${defs.length})` },
            ...(counts.app ? [{ value: "app", label: `${t("From the app")} (${counts.app})` }] : []),
            ...(counts.mine ? [{ value: "mine", label: `${t("My widgets")} (${counts.mine})` }] : []),
            ...plugins.map((p) => ({ value: p, label: `${originName(p)} (${counts[p] ?? 0})`, group: t("Plugins") })),
          ]}
        />
        {current !== "all" && <IconButton icon={X} size="sm" label={t("Clear filter")} onClick={() => setOrigin("all")} />}
      </div>
      {cats.map((cat) => {
        const items = shown.filter(([, d]) => d.category === cat.id).sort(([, a], [, b]) => rank(widgetOrigin(a)).localeCompare(rank(widgetOrigin(b))));
        if (!items.length) return null;
        const mixed = new Set(items.map(([, d]) => widgetOrigin(d))).size > 1;
        const gid = "w:" + cat.id;
        let last: string | null = null;
        return (
          <LibGroup key={gid} label={t(cat.label)} color={String(cat.color)} count={items.length} open={!!query || open.includes(gid)} onToggle={() => toggle(gid)}>
            {items.flatMap(([id, d]) => {
              const o = widgetOrigin(d);
              const out: ReactNode[] = [];
              if (mixed && o !== last) out.push(<LibSub key={`sub:${o}`} origin={(o === "app" || o === "mine" ? o : "plugin") as Origin} label={originName(o)} />);
              last = o;
              out.push(<WidgetItem key={id} id={id} def={d} query={query} page={page} color={String(cat.color)} withTag={!mixed && o !== "app" && o !== "mine" && current === "all"} />);
              return out;
            })}
          </LibGroup>
        );
      })}
      {!shown.length ? (
        <p className="mt-3 mb-0 px-2 text-xs text-fg-subtle">{current !== "all" ? t("No widgets from this origin match.") : t("No widgets found.")}</p>
      ) : current !== "all" ? (
        <p className="mt-3 mb-0 px-2 text-xs text-fg-subtle">
          {t("Only the widgets from {0}, in their usual categories.", [originName(current)])}{" "}
          <button type="button" onClick={() => setOrigin("all")} className="cursor-pointer font-semibold text-fg underline">
            {t("Clear filter")}
          </button>
        </p>
      ) : null}
    </>
  );
}

function WidgetItem({ id, def, query, page, color, withTag }: { id: string; def: Obj; query: string; page: string; color: string; withTag: boolean }) {
  const t = useT();
  const idx = useLucideIndex();
  const placer = usePlacer(page);
  const setOrigin = useLib((s) => s.setOrigin);
  const widgetOpen = useLib((s) => s.widgetOpen);
  const toggleWidget = useLib((s) => s.toggleWidget);
  const originName = useOriginName();
  const sizes = Object.keys(def.sizes as Obj);
  const first = sizes[0] ?? "1x1";
  const label = String(def.label);
  const open = widgetOpen.includes(id) || (!!query && sizes.length > 1);
  const [cols, rows] = sizeColsRows(first);
  const payload: DragPayload = { kind: "widget", widget: id, size: first, label, cols, rows };
  const { ref } = useLibDrag(`w:${id}`, payload);
  const many = sizes.length > 1;
  // um pedido só para as miniaturas deste widget (a do 1º tamanho sempre: é a da peça arrastada)
  const thumbOf = (size: string): ThumbItem => ({ widget: id, size, options: null, colors: null });
  const srcs = useThumbs((open && many ? sizes : [first]).map(thumbOf));
  const activate = () => {
    if (many) return toggleWidget(id);
    const k = useUi.getState().key;
    if (k) void placer.placeWidget(k, id, first);
    else toast(t("Click a key first, or drag the widget onto it."));
  };
  return (
    <>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-expanded={many ? open : undefined}
        title={many ? t("Drag onto the Deck, or open to see the sizes") : t("Drag onto the Deck")}
        style={catStyle(color)}
        className={ITEM}
        onClick={activate}
        onKeyDown={(e) => {
          // Enter abre ou coloca; o Espaço é do arrastar pelo teclado (pega a peça)
          if (e.key === "Enter") {
            e.preventDefault();
            activate();
          }
        }}
      >
        <Chip glyph={idx ? luChar(idx, typeof def.icon === "string" ? def.icon : "layout-grid") : ""} />
        <span className="font-medium">{label}</span>
        {withTag && typeof def.plugin === "string" && (
          <Tag title={t("Show only the widgets from {0}", [originName(def.plugin)])} onClick={() => setOrigin(def.plugin as string)}>
            <Icon icon={Plug} size="xs" />
            {originName(def.plugin)}
          </Tag>
        )}
      </div>
      {open && many && (
        <div className="flex flex-wrap gap-1.5 pt-1 pr-2 pb-2.5 pl-1">
          {sizes.map((size) => (
            <SizePiece key={size} id={id} size={size} label={label} page={page} srcs={srcs(thumbOf(size))} />
          ))}
        </div>
      )}
    </>
  );
}

function SizePiece({ id, size, label, page, srcs }: { id: string; size: string; label: string; page: string; srcs: string[] }) {
  const t = useT();
  const placer = usePlacer(page);
  const [cols, rows] = sizeColsRows(size);
  const sizeLabel = size.replace("x", "×");
  const payload = useMemo<DragPayload>(() => ({ kind: "widget", widget: id, size, label, cols, rows }), [id, size, label, cols, rows]);
  const { ref } = useLibDrag(`w:${id}:${size}`, payload);
  return (
    <SizeTile
      ref={ref}
      label={sizeLabel}
      rows={rows}
      unit={18}
      compact
      title={t("{0} in {1}", [label, sizeLabel])}
      onClick={() => {
        const k = useUi.getState().key;
        if (k) void placer.placeWidget(k, id, size);
        else toast(t("Click a key first, or drag the piece onto it."));
      }}
    >
      <WidgetThumb srcs={srcs} cols={cols} rows={rows} unit={18} />
    </SizeTile>
  );
}

/** A miniatura de um widget num tamanho: uma grade de teclas com o desenho de verdade de cada uma. */
export function WidgetThumb({ srcs, cols, rows, unit, dim }: { srcs: string[]; cols: number; rows: number; unit: number; dim?: boolean }) {
  return (
    <span aria-hidden className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${cols}, ${unit}px)`, gridAutoRows: `${unit}px` }}>
      {Array.from({ length: cols * rows }, (_, i) => (
        <span key={i} className="block overflow-hidden rounded-xs bg-key-graphite inset-ring inset-ring-tint-hover">
          {srcs[i] && <img src={srcs[i]} alt="" className={cn("block size-full", dim && "brightness-60 grayscale")} />}
        </span>
      ))}
    </span>
  );
}
