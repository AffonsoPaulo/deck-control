// A peça que acompanha o ponteiro, do tamanho exato que vai ocupar na grade: a imagem da tecla (ou do bloco), a
// miniatura do widget, ou o ícone e o nome que a tecla nova vai ganhar (ação, tecla guardada).
import type { CSSProperties } from "react";
import { useLucideIndex } from "@/components/IconPicker";
import { useT } from "@/core/i18n";
import { luChar } from "@/core/icons/lucide";
import { useSchema } from "@/core/queries";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { actionDefs, autoIcon, groupsOf, newStep, savedKeys, type IconSpec } from "@/features/keys/actions";
import { useDeckState } from "@/features/keys/deckState";
import { pageKeysOf, pieceSize, spanOf, type DragPayload } from "@/features/keys/model";
import { isCells, type KeyPreview } from "@/features/keys/previews";
import { cachedThumb } from "@/features/keys/thumbs";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function Cell({ icon }: { icon: IconSpec & { sub?: string } }) {
  const idx = useLucideIndex();
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 overflow-hidden rounded-lg text-center text-key-fg inset-ring-2 inset-ring-accent"
      style={{ background: typeof icon.bg === "string" ? icon.bg : "#1d2330" }}
    >
      {icon.lucide && idx && <span className="font-lucide text-(length:--icon-xl) leading-none">{luChar(idx, icon.lucide)}</span>}
      {icon.text && <b className="text-xs">{icon.text}</b>}
      {icon.sub && <small className="text-2xs">{icon.sub}</small>}
    </div>
  );
}

export function Ghost({ payload, page, previews }: { payload: DragPayload; page: string; previews: KeyPreview[] | undefined }) {
  const t = useT();
  const schema = useSchema().data;
  const cfg = useConfig((s) => s.cfg);
  const view = useUi((s) => s.view);
  const { size, gapX, gapY } = useDeckState();
  let [cols] = pieceSize(payload);
  let cells: React.ReactNode[] = [];

  if (payload.kind === "key") {
    [cols] = spanOf(pageKeysOf(cfg, page)[payload.key]);
    const p = previews?.[Number(payload.key) - 1] ?? null;
    const srcs = isCells(p) ? p.cells : p ? [view === "active" && p.active ? p.active : p.normal] : [];
    cells = srcs.map((src, j) => <img key={j} src={src} alt="" className="block size-full rounded-lg inset-ring-2 inset-ring-accent" />);
  } else if (payload.kind === "widget") {
    const srcs = cachedThumb({ widget: payload.widget, size: payload.size, options: null, colors: null }) ?? [];
    cells = srcs.map((src, j) => <img key={j} src={src} alt="" className="block size-full rounded-lg" />);
  } else if (payload.kind === "new") {
    const defs = actionDefs(schema);
    const step = newStep(defs, payload.type, { pages: [], page, scenes: [] });
    cells = [<Cell key={0} icon={autoIcon(t, defs, groupsOf(schema), step)} />];
  } else {
    const item = savedKeys(cfg)[payload.index];
    const icon = isObj(item?.key.icon) ? (item.key.icon as IconSpec) : { text: typeof item?.key.icon === "string" ? item.key.icon : "" };
    const list = Array.isArray(item?.key.cells) && item.key.cells.length ? (item.key.cells as IconSpec[]) : [icon];
    cells = list.map((c, j) => <Cell key={j} icon={isObj(c) ? c : { text: String(c) }} />);
  }

  const style: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, ${size}px)`,
    gridAutoRows: `${size}px`,
    columnGap: gapX,
    rowGap: gapY,
    pointerEvents: "none",
  };
  return <div style={style}>{cells.length ? cells : <div className="rounded-lg bg-raised inset-ring-2 inset-ring-accent" />}</div>;
}
