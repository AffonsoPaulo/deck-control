// O inspetor (coluna da direita da seção Teclas): sem tecla escolhida, como montar o Deck; tecla vazia, as ações
// rápidas; tecla com algo, o cabeçalho (miniatura, nome, ferramentas) e as abas. Nesta parte: a aba Aparência da
// tecla simples. "O que faz", "Luz" e a aparência de bloco, informação e widget ainda abrem no editor atual.
import { BookmarkPlus, Check, ClipboardPaste, Copy, LayoutGrid, ListOrdered, MousePointer2, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { SectionPlaceholder } from "@/app/SectionPlaceholder";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { useLucideIndex } from "@/components/IconPicker";
import { Chip, catStyle } from "@/components/Library";
import { useT } from "@/core/i18n";
import { luChar } from "@/core/icons/lucide";
import type { Place } from "@/core/hash";
import { normalizeIcon } from "@/core/obj";
import { useSchema } from "@/core/queries";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { actionDefs, groupOf, groupsOf, iconOf, widgetDefs } from "@/features/keys/actions";
import { ActionPicker } from "@/features/keys/ActionPicker";
import { LookTab } from "@/features/keys/inspector/LookTab";
import { isInfoKey } from "@/features/keys/look";
import { useKeyOps } from "@/features/keys/keyOps";
import { draftKeys } from "@/features/keys/keys";
import { pageKeysOf, spanOf, type KeySpec } from "@/features/keys/model";
import { usePlacer } from "@/features/keys/place";
import { isCells, type KeyPreview } from "@/features/keys/previews";
import { useSession } from "@/features/keys/session";

const QUICK = ["hotkey", "launch", "obs.scene", "discord.mute", "page", "media"];

export function Inspector({ page, previews, place }: { page: string; previews: KeyPreview[] | undefined; place: Place }) {
  const k = useUi((s) => s.key);
  const spec = useConfig((s) => (k ? pageKeysOf(s.cfg, page)[k] : undefined));
  return (
    <aside className="min-h-0 w-107.5 flex-none overflow-y-auto border-l border-border bg-surface scrollbar-stable">
      {k === null ? <Guide /> : !spec ? <EmptyKey page={page} k={k} /> : <KeyInspector page={page} k={k} spec={spec} preview={previews?.[Number(k) - 1] ?? null} place={place} />}
    </aside>
  );
}

// ---------------------------------------------------------------------------- sem tecla e tecla vazia

function Guide() {
  const t = useT();
  const steps: [typeof Pencil, string, string][] = [
    [MousePointer2, t("1. Drag an action onto a key"), t("The list is on the left. The key gets a name and icon on its own.")],
    [Pencil, t("2. Click the key to adjust it"), t("Change the name, color, icon and what it does.")],
    [Check, t("3. Done"), t("Everything saves on its own, and the Deck updates right away.")],
    [ListOrdered, t("Want more?"), t('A key can do several things in sequence, or choose between two with the "If… then… else" block. All inside "What it does".')],
  ];
  return (
    <div className="px-4.5 py-6.5">
      <h2 className="m-0 mb-1.5 text-lg leading-(--text-base--line-height) font-bold">{t("How to set up your Deck")}</h2>
      <div className="mt-2 grid gap-3.5">
        {steps.map(([icon, title, text]) => (
          <div key={title} className="flex items-start gap-3" style={catStyle("var(--fg-muted)")}>
            <Chip icon={icon} size="lg" />
            <p className="m-0 text-fg-muted">
              <b className="block">{title}</b>
              <span className="text-sm text-fg-muted">{text}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyKey({ page, k }: { page: string; k: string }) {
  const t = useT();
  const idx = useLucideIndex();
  const schema = useSchema().data;
  const placer = usePlacer(page);
  const ops = useKeyOps(page);
  const clipboard = useSession((s) => s.clipboard);
  const [picker, setPicker] = useState(false);
  const defs = actionDefs(schema);
  const groups = groupsOf(schema);
  const quick = "flex cursor-pointer items-center gap-2.5 rounded-lg border border-border-strong bg-surface p-2.5 text-left font-medium hover:border-fg-subtle hover:bg-sunken focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <div className="px-4.5 py-6.5">
      <h2 className="m-0 mb-1.5 text-lg leading-(--text-base--line-height) font-bold">{t("Key {0} is empty", [k])}</h2>
      <p className="m-0 mb-4.5 text-fg-muted">{t("Drag an action from the list onto it, or pick one of these:")}</p>
      <div className="grid grid-cols-2 gap-2">
        {QUICK.filter((type) => defs[type]).map((type) => (
          <button key={type} type="button" className={quick} style={catStyle(groupOf(groups, defs, type).color)} onClick={() => void placer.assign(k, type)}>
            <Chip glyph={idx ? luChar(idx, iconOf(defs, type)) : ""} />
            {t(defs[type]?.label ?? type)}
          </button>
        ))}
        <button type="button" className={quick} style={catStyle("var(--cat-gray)")} onClick={() => setPicker(true)}>
          <Chip icon={LayoutGrid} />
          {t("See all")}
        </button>
      </div>
      {clipboard && (
        <Button size="sm" icon={ClipboardPaste} className="mt-3.5" onClick={() => void ops.paste(k)}>
          {t("Paste the copied key")}
        </Button>
      )}
      <ActionPicker open={picker} onOpenChange={setPicker} onPick={(type) => void placer.assign(k, type)} />
    </div>
  );
}

// ---------------------------------------------------------------------------- tecla com algo

const isWidget = (spec: KeySpec) => !!spec.widget;

function KeyInspector({ page, k, spec, preview, place }: { page: string; k: string; spec: KeySpec; preview: KeyPreview; place: Place }) {
  const t = useT();
  const tab = useUi((s) => s.tab);
  const go = useUi((s) => s.go);
  const edit = useConfig((s) => s.edit);
  const ops = useKeyOps(page);
  const schema = useSchema().data;
  const cfg = useConfig((s) => s.cfg);
  const clipboard = useSession((s) => s.clipboard);
  const [cols, rows] = spanOf(spec);
  const block = cols * rows > 1;
  const widget = isWidget(spec);
  const info = isInfoKey(spec);
  const thumb = isCells(preview) ? preview.cells[0] : preview?.normal;
  const icon = normalizeIcon(spec.icon);
  const sub = widget
    ? t("Widget {0} from key {1}, page {2}", [`${rows}×${cols}`, k, page])
    : block
      ? t("Block {0} from key {1}, page {2}", [`${rows}×${cols}`, k, page])
      : t("Key {0}, page {1}", [k, page]);
  const widgetLabel = widget ? (widgetDefs(schema, cfg)[String(spec.widget)]?.label ?? spec.widget) : null;
  const staticTitle = widget ? String(widgetLabel) : info && !block ? t("Information") : null;
  const tabs: [typeof tab, string][] = widget
    ? [
        ["look", t("Widget")],
        ["do", t("What it does")],
        ["light", t("Light")],
      ]
    : [
        ["do", t("What it does")],
        ["look", t("Appearance")],
        ["light", t("Light")],
      ];
  const ready = tab === "look" && !widget && !block && !info;

  return (
    <>
      <div className="sticky top-0 z-(--z-raised) flex items-center gap-3 bg-surface px-4.5 pt-4 pb-3">
        {thumb ? <img className="deck-insp-thumb" src={thumb} alt="" /> : <span className="deck-insp-thumb" />}
        <div className="min-w-0 flex-1">
          {staticTitle ? (
            <span className="block truncate py-0.75 text-lg font-bold text-fg">{staticTitle}</span>
          ) : (
            <input
              type="text"
              value={typeof icon.text === "string" ? icon.text.replace(/\n/g, " ") : ""}
              placeholder={t("Unnamed")}
              aria-label={t("Key name")}
              onChange={(e) => {
                const v = e.target.value;
                edit((d) => {
                  const s = draftKeys(d, page)[k];
                  if (!s) return;
                  const next = { ...normalizeIcon(s.icon), text: v };
                  if (!v) Reflect.deleteProperty(next, "text");
                  s.icon = next;
                }, `name:${page}:${k}`);
              }}
              className="-ml-1.75 h-control-sm w-full rounded-md border border-transparent bg-transparent px-1.5 text-lg font-bold text-fg outline-none placeholder:text-fg-subtle hover:border-border-strong focus:border-fg focus:bg-sunken"
            />
          )}
          <small className="block text-xs text-fg-subtle">{sub}</small>
        </div>
        <div className="flex gap-0.5">
          <IconButton icon={Play} label={t("Test")} title={t("Test (runs the saved version)")} onClick={() => void ops.test(k)} />
          <IconButton icon={Copy} label={t("Copy")} title={t("Copy (Ctrl+C)")} onClick={() => ops.copy(k)} />
          <IconButton icon={BookmarkPlus} label={t("Save key")} title={t("Save to use later (Saved keys)")} onClick={() => ops.save(k)} />
          <IconButton icon={ClipboardPaste} label={t("Paste")} title={t("Paste (Ctrl+V)")} disabled={!clipboard} onClick={() => void ops.paste(k)} />
          <IconButton icon={Trash2} label={t("Delete key")} title={t("Delete key (Delete)")} onClick={() => ops.remove(k)} className="hover:enabled:text-danger-fg" />
        </div>
      </div>
      <div role="tablist" className="sticky top-20 z-(--z-raised) flex items-center gap-1 border-b border-border bg-surface px-4.5">
        {tabs.map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => go({ tab: v })}
            className="relative mr-3.5 cursor-pointer px-1 pt-2.5 pb-2.75 font-semibold text-fg-subtle transition-colors duration-(--duration-base) aria-selected:text-fg aria-selected:after:absolute aria-selected:after:inset-x-0 aria-selected:after:-bottom-px aria-selected:after:h-0.5 aria-selected:after:rounded-xs aria-selected:after:bg-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            {l}
          </button>
        ))}
      </div>
      {ready ? <LookTab page={page} k={k} spec={spec} preview={preview} /> : <SectionPlaceholder place={place} compact />}
    </>
  );
}

