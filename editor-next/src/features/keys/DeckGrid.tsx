// A grade do Deck: as 15 teclas desenhadas pelo servidor (prévias), os blocos de várias teclas, escolher uma
// tecla, as marcas de onde a peça arrastada vai cair e soltar uma imagem do Windows numa tecla. O arrastar em si
// (provedor, mover, soltar) é da seção (KeysSection), porque a biblioteca também arrasta para cá.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import { useT } from "@/core/i18n";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { undoButton } from "@/core/store/undo";
import {
  BookmarkPlus,
  ClipboardPaste,
  Combine,
  Copy,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/Button";
import { ContextMenuArea, type MenuEntry } from "@/components/Menu";
import { useSchema } from "@/core/queries";
import {
  clearMulti,
  joinKeys,
  multiRect,
  toggleMulti,
  useMulti,
} from "@/features/keys/join";
import { useKeyOps } from "@/features/keys/keyOps";
import { placedToastFor } from "@/features/keys/place";
import { useSession } from "@/features/keys/session";
import { toast } from "@/core/toast";
import { measureGrid, useDeckState } from "@/features/keys/deckState";
import { useKeyDnd } from "@/features/keys/dnd";
import {
  KEYS,
  coverMap,
  kpos,
  pageKeysOf,
  spanOf,
  type KeySpec,
  type PageKeys,
} from "@/features/keys/model";
import {
  isCells,
  usePagePreviews,
  type KeyPreview,
} from "@/features/keys/previews";
import { normalizeIcon } from "@/core/obj";
import { draftKeys, keyText, uploadImage } from "@/features/keys/keys";

const EMPTY: PageKeys = {};

export function DeckGrid({ page }: { page: string }) {
  const t = useT();
  const keys = useConfig((s) => (s.cfg ? pageKeysOf(s.cfg, page) : EMPTY));
  const edit = useConfig((s) => s.edit);
  const selected = useUi((s) => s.key);
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  const tip = useDeckState((s) => s.foot.tip);
  const previews = usePagePreviews(page);
  const cover = useMemo(() => coverMap(keys), [keys]);
  const multi = useMulti((s) => s.keys);
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);

  // medidas de uma tecla (passo das setas e tamanho da peça arrastada)
  useEffect(() => {
    if (!grid) return;
    const measure = () => measureGrid(grid);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => {
      ro.disconnect();
      useDeckState.setState({ grid: null });
    };
  }, [grid]);

  const dropImage = async (k: string, file: File) => {
    try {
      const path = await uploadImage(file);
      edit((d) => {
        const ks = draftKeys(d, page);
        const spec = ks[k];
        ks[k] = spec
          ? { ...spec, icon: { ...normalizeIcon(spec.icon), image: path } }
          : { icon: { image: path, bg: "#000000" } };
      });
      go({ key: k });
      toast(t("Image applied to the key."), { undo: undoButton(t) });
    } catch (e) {
      toast(t("Error sending the image: ") + (e as Error).message, {
        bad: true,
      });
    }
  };

  return (
    <div className="deck-wrap">
      <div className="deck">
        <div
          ref={setGrid}
          className="deck-keys"
          role="group"
          aria-label={t("Deck keys")}
        >
          {/* casas invisíveis só para medir a tecla e o vão (uma por posição) */}
          {KEYS.map((k) => {
            const [c, r] = kpos(k);
            return (
              <i
                key={`c${k}`}
                data-cell={k}
                aria-hidden
                style={{
                  gridColumn: c + 1,
                  gridRow: r + 1,
                  visibility: "hidden",
                }}
              />
            );
          })}
          {KEYS.map((k, i) =>
            cover[k] ? null : (
              <DeckKey
                key={k}
                k={k}
                spec={keys[k]}
                preview={previews?.[i] ?? null}
                view={view}
                selected={selected === k}
                multi={multi.includes(k)}
                onSelect={(shift) => {
                  // Shift+clique: escolhe várias para juntar; clique normal desfaz a escolha
                  if (shift) return toggleMulti(k);
                  if (multi.length) clearMulti();
                  go({ key: k, lookMode: "normal" });
                }}
                onImage={(file) => void dropImage(k, file)}
              />
            ),
          )}
        </div>
      </div>
      {tip && (
        <div className="absolute bottom-1.5 left-1/2 z-(--z-float) flex h-control-lg -translate-x-1/2 items-center gap-2 rounded-md bg-fg px-3 text-sm font-bold whitespace-nowrap text-canvas">
          {tip}
        </div>
      )}
      {!tip && multi.length >= 2 && <JoinBar page={page} />}
    </div>
  );
}

interface DeckKeyProps {
  k: string;
  spec: KeySpec | undefined;
  preview: KeyPreview;
  view: "normal" | "active";
  selected: boolean;
  multi: boolean;
  onSelect: (shift: boolean) => void;
  onImage: (file: File) => void;
}

function DeckKey({
  k,
  spec,
  preview,
  view,
  selected,
  multi,
  onSelect,
  onImage,
}: DeckKeyProps) {
  const t = useT();
  const menu = useKeyMenu(k);
  const { ref, isDragging, isOver } = useKeyDnd(k);
  const foot = useDeckState((s) =>
    s.foot.bad === k
      ? "bad"
      : s.foot.replace.includes(k)
        ? "replace"
        : s.foot.cells.includes(k)
          ? "foot"
          : null,
  );
  const [fileOver, setFileOver] = useState(false);
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pressTimer.current), []);
  const [cols, rows] = spanOf(spec);
  const [c0, r0] = kpos(k);
  const block = cols * rows > 1;
  const summary = keyText(spec);
  const style = {
    gridColumn: `${c0 + 1} / span ${cols}`,
    gridRow: `${r0 + 1} / span ${rows}`,
    "--bc": cols,
    "--br": rows,
  } as CSSProperties;
  const hasFiles = (e: DragEvent) =>
    [...e.dataTransfer.types].includes("Files");
  // a marca de "vai cair aqui" da troca de teclas só quando não há marca de encaixe (peça da biblioteca)
  const drop = ((isOver && !isDragging && !foot) || fileOver) as boolean;

  return (
    <ContextMenuArea
      items={menu}
      label={t("Key {0}", [k])}
      className="contents"
    >
      <button
        ref={ref}
        type="button"
        className="deck-key"
        data-key={k}
        style={style}
        aria-roledescription={t("draggable key")}
        // escolhida: aria-current (o dnd-kit usa o aria-pressed das peças arrastáveis e apagaria o nosso)
        aria-current={selected || undefined}
        data-selected={selected || undefined}
        aria-label={
          !spec
            ? t("Key {0}, empty", [k])
            : summary
              ? t("Key {0}: {1}", [k, summary])
              : t("Key {0}", [k])
        }
        title={
          spec ? summary || undefined : t("Empty key: drag an action here")
        }
        data-empty={!spec || undefined}
        data-block={block || undefined}
        data-drop={drop || undefined}
        data-foot={foot ?? undefined}
        data-dragging={isDragging || undefined}
        data-pressed={pressed || undefined}
        data-multi={multi || undefined}
        onClick={(e) => {
          onSelect(e.shiftKey);
          setPressed(true);
          clearTimeout(pressTimer.current);
          pressTimer.current = setTimeout(() => setPressed(false), 110);
        }}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setFileOver(true);
        }}
        onDragLeave={() => setFileOver(false)}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setFileOver(false);
          const f = e.dataTransfer.files[0];
          if (f?.type.startsWith("image/")) onImage(f);
        }}
      >
        {block ? (
          Array.from({ length: cols * rows }, (_, j) => {
            const src = isCells(preview) ? preview.cells[j] : undefined;
            return (
              <span key={j} className="deck-cell">
                {src && <img src={src} alt="" />}
              </span>
            );
          })
        ) : spec && preview && !isCells(preview) ? (
          <img
            src={
              view === "active" && preview.active
                ? preview.active
                : preview.normal
            }
            alt=""
          />
        ) : null}
        {foot === "replace" && (
          <span className="deck-replace">{t("replaces")}</span>
        )}
      </button>
    </ContextMenuArea>
  );
}

/** Botão direito numa tecla: copiar, colar, guardar e apagar (o openKeyMenu do editor atual). */
function useKeyMenu(k: string): () => MenuEntry[] {
  const t = useT();
  const page = useUi((s) => s.page) ?? "";
  const ops = useKeyOps(page);
  return () => {
    useUi.getState().go({ key: k, lookMode: "normal" });
    const spec = pageKeysOf(useConfig.getState().cfg, page)[k];
    const clip = !!useSession.getState().clipboard;
    return [
      {
        label: t("Copy"),
        icon: Copy,
        kbd: "Ctrl+C",
        disabled: !spec,
        onSelect: () => ops.copy(k),
      },
      {
        label: t("Paste"),
        icon: ClipboardPaste,
        kbd: "Ctrl+V",
        disabled: !clip,
        onSelect: () => void ops.paste(k),
      },
      {
        label: t("Save key"),
        icon: BookmarkPlus,
        disabled: !spec,
        onSelect: () => ops.save(k),
      },
      { type: "separator" },
      {
        label: t("Delete key"),
        icon: Trash2,
        kbd: "Del",
        danger: true,
        disabled: !spec,
        onSelect: () => ops.remove(k),
      },
    ];
  };
}

/** A barra de juntar: o tamanho do bloco, ou o que falta para formar um retângulo. */
function JoinBar({ page }: { page: string }) {
  const t = useT();
  const schema = useSchema().data;
  const keys = useConfig((s) => pageKeysOf(s.cfg, page));
  const sel = useMulti((s) => s.keys);
  const rect = multiRect(keys, sel);
  return (
    <div
      role="toolbar"
      aria-label={t("Join keys")}
      className="absolute bottom-1.5 left-1/2 z-(--z-float) flex -translate-x-1/2 items-center gap-2 rounded-md bg-raised p-1 whitespace-nowrap shadow-popover"
    >
      {rect ? (
        <Button
          variant="primary"
          icon={Combine}
          onClick={() => {
            const r = joinKeys(t, page);
            if (r)
              placedToastFor(t, schema)(
                t("Keys joined into a {0} block.", [r.size]),
                r.removed,
              );
          }}
        >
          {t("Join {0}", [`${rect.rows}×${rect.cols}`])}
        </Button>
      ) : (
        <span className="px-2 text-sm text-fg-muted">
          {t("Select a full rectangle of keys (no gaps).")}
        </span>
      )}
      <Button onClick={clearMulti}>{t("Cancel")}</Button>
    </div>
  );
}
