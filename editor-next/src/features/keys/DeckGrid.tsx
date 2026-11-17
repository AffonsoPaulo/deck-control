// A grade do Deck: as 15 teclas desenhadas pelo servidor (prévias), os blocos de várias teclas, escolher uma
// tecla, as marcas de onde a peça arrastada vai cair e soltar uma imagem do Windows numa tecla. O arrastar em si
// (provedor, mover, soltar) é da seção (KeysSection), porque a biblioteca também arrasta para cá.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { api } from "@/core/api";
import { useT } from "@/core/i18n";
import { useConfig, type Config } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { undoButton } from "@/core/store/undo";
import { toast } from "@/core/toast";
import { measureGrid, useDeckState } from "@/features/keys/deckState";
import { useKeyDnd } from "@/features/keys/dnd";
import { KEYS, coverMap, kpos, pageKeysOf, spanOf, type KeySpec, type PageKeys } from "@/features/keys/model";
import { isCells, usePagePreviews, type KeyPreview } from "@/features/keys/previews";

const EMPTY: PageKeys = {};

const draftKeys = (d: Config, page: string): PageKeys => {
  const pages = (d.pages ??= {}) as Record<string, PageKeys>;
  return (pages[page] ??= {});
};

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

  const dropImage = (k: string, file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { path } = await api("POST /api/upload", { name: file.name, data: String(reader.result) });
        edit((d) => {
          const ks = draftKeys(d, page);
          const spec = ks[k];
          const icon = typeof spec?.icon === "string" ? { text: spec.icon } : ((spec?.icon as Record<string, unknown> | undefined) ?? {});
          ks[k] = spec ? { ...spec, icon: { ...icon, image: path } } : { icon: { image: path, bg: "#000000" } };
        });
        go({ key: k });
        toast(t("Image applied to the key."), { undo: undoButton(t) });
      } catch (e) {
        toast(t("Error sending the image: ") + (e as Error).message, { bad: true });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="deck-wrap">
      <div className="deck">
        <div ref={setGrid} className="deck-keys" role="group" aria-label={t("Deck keys")}>
          {/* casas invisíveis só para medir a tecla e o vão (uma por posição) */}
          {KEYS.map((k) => {
            const [c, r] = kpos(k);
            return <i key={`c${k}`} data-cell={k} aria-hidden style={{ gridColumn: c + 1, gridRow: r + 1, visibility: "hidden" }} />;
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
                onSelect={() => go({ key: k, lookMode: "normal" })}
                onImage={(file) => dropImage(k, file)}
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
    </div>
  );
}

interface DeckKeyProps {
  k: string;
  spec: KeySpec | undefined;
  preview: KeyPreview;
  view: "normal" | "active";
  selected: boolean;
  onSelect: () => void;
  onImage: (file: File) => void;
}

function DeckKey({ k, spec, preview, view, selected, onSelect, onImage }: DeckKeyProps) {
  const t = useT();
  const { ref, isDragging, isOver } = useKeyDnd(k);
  const foot = useDeckState((s) => (s.foot.bad === k ? "bad" : s.foot.replace.includes(k) ? "replace" : s.foot.cells.includes(k) ? "foot" : null));
  const [fileOver, setFileOver] = useState(false);
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pressTimer.current), []);
  const [cols, rows] = spanOf(spec);
  const [c0, r0] = kpos(k);
  const block = cols * rows > 1;
  const text = (spec?.icon as { text?: unknown } | undefined)?.text;
  const summary = typeof text === "string" ? text : typeof spec?.icon === "string" ? spec.icon : "";
  const style = { gridColumn: `${c0 + 1} / span ${cols}`, gridRow: `${r0 + 1} / span ${rows}`, "--bc": cols, "--br": rows } as CSSProperties;
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  // a marca de "vai cair aqui" da troca de teclas só quando não há marca de encaixe (peça da biblioteca)
  const drop = ((isOver && !isDragging && !foot) || fileOver) as boolean;

  return (
    <button
      ref={ref}
      type="button"
      className="deck-key"
      data-key={k}
      style={style}
      // escolhida: aria-current (o dnd-kit usa o aria-pressed das peças arrastáveis e apagaria o nosso)
      aria-current={selected || undefined}
      data-selected={selected || undefined}
      aria-label={!spec ? t("Key {0}, empty", [k]) : summary ? t("Key {0}: {1}", [k, summary]) : t("Key {0}", [k])}
      title={spec ? summary || undefined : t("Empty key: drag an action here")}
      data-empty={!spec || undefined}
      data-block={block || undefined}
      data-drop={drop || undefined}
      data-foot={foot ?? undefined}
      data-dragging={isDragging || undefined}
      data-pressed={pressed || undefined}
      onClick={() => {
        onSelect();
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
        <img src={view === "active" && preview.active ? preview.active : preview.normal} alt="" />
      ) : null}
      {foot === "replace" && <span className="deck-replace">{t("replaces")}</span>}
    </button>
  );
}
