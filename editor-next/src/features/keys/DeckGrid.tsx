// A grade do Deck: as 15 teclas desenhadas pelo servidor (prévias), os blocos de várias teclas, escolher uma
// tecla, arrastar uma tecla para trocar de lugar e soltar uma imagem do Windows numa tecla.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { api } from "@/core/api";
import { useT } from "@/core/i18n";
import { useConfig, type Config } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { undoButton } from "@/core/store/undo";
import { toast } from "@/core/toast";
import { DeckDnd, useKeyDnd, type Pitch } from "@/features/keys/dnd";
import {
  KEYS,
  cellAt,
  coverMap,
  kpos,
  pageKeysOf,
  resolveDrop,
  selectionAfterSwap,
  spanOf,
  swapKeys,
  type DragPayload,
  type KeySpec,
  type PageKeys,
} from "@/features/keys/model";
import { isCells, usePagePreviews, type KeyPreview } from "@/features/keys/previews";

const EMPTY: PageKeys = {};

/** As teclas da página como estão no rascunho (para mexer dentro de um edit). */
const draftKeys = (d: Config, page: string): PageKeys => {
  const pages = (d.pages ??= {}) as Record<string, PageKeys>;
  return (pages[page] ??= {});
};

/** Quanto anda uma seta no arrastar pelo teclado: uma tecla (largura + vão), medido na tela. */
function usePitch(grid: HTMLElement | null): Pitch {
  const [pitch, setPitch] = useState<Pitch>({ x: 100, y: 100 });
  useEffect(() => {
    if (!grid) return;
    const measure = () => {
      const a = grid.querySelector<HTMLElement>('[data-cell="1"]');
      const b = grid.querySelector<HTMLElement>('[data-cell="2"]');
      const c = grid.querySelector<HTMLElement>('[data-cell="6"]');
      if (!a || !b || !c) return;
      const ra = a.getBoundingClientRect();
      setPitch({ x: b.getBoundingClientRect().left - ra.left || 100, y: c.getBoundingClientRect().top - ra.top || 100 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [grid]);
  return pitch;
}

export function DeckGrid({ page }: { page: string }) {
  const t = useT();
  const keys = useConfig((s) => (s.cfg ? pageKeysOf(s.cfg, page) : EMPTY));
  const edit = useConfig((s) => s.edit);
  const selected = useUi((s) => s.key);
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  const previews = usePagePreviews(page);
  const cover = useMemo(() => coverMap(keys), [keys]);
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const pitch = usePitch(grid);

  // o dnd-kit guarda a primeira versão desta função: ela lê o estado na hora de soltar, nunca o do render
  const onDrop = (payload: DragPayload, target: string, point: { x: number; y: number }) => {
    const now = pageKeysOf(useConfig.getState().cfg, page);
    const el = grid?.querySelector<HTMLElement>(`[data-key="${target}"]`);
    const cell = el ? cellAt(target, now[target], el.getBoundingClientRect(), point.x, point.y) : target;
    const r = resolveDrop(payload, cell, now);
    if (r.op !== "swap") return;
    edit((d) => swapKeys(draftKeys(d, page), r.a, r.b));
    go({ key: selectionAfterSwap(useUi.getState().key, r.a, r.b) });
  };

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
    <DeckDnd pitch={pitch} onDrop={onDrop} ghost={(p) => <Ghost payload={p} keys={keys} previews={previews} view={view} />}>
      <div className="deck-wrap">
        <div className="deck">
          <div ref={setGrid} className="deck-keys" role="group" aria-label={t("Deck keys")}>
            {/* casas invisíveis só para medir o passo das setas (uma por posição) */}
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
      </div>
    </DeckDnd>
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
  const payload = useMemo<DragPayload | null>(() => (spec ? { kind: "key", key: k } : null), [spec, k]);
  const { ref, isDragging, isOver } = useKeyDnd(k, payload);
  const [fileOver, setFileOver] = useState(false);
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pressTimer.current), []);
  const [cols, rows] = spanOf(spec);
  const [c0, r0] = kpos(k);
  const block = cols * rows > 1;
  const summary = typeof (spec?.icon as { text?: unknown } | undefined)?.text === "string" ? String((spec?.icon as { text: string }).text) : "";
  const style = { gridColumn: `${c0 + 1} / span ${cols}`, gridRow: `${r0 + 1} / span ${rows}`, "--bc": cols, "--br": rows } as CSSProperties;
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");

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
      data-drop={(isOver && !isDragging) || fileOver || undefined}
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
    </button>
  );
}

/** A peça que acompanha o ponteiro: o desenho da tecla (ou do bloco) que está sendo arrastada. */
function Ghost({ payload, keys, previews, view }: { payload: DragPayload; keys: PageKeys; previews: KeyPreview[] | undefined; view: "normal" | "active" }) {
  if (payload.kind !== "key") return null;
  const p = previews?.[Number(payload.key) - 1] ?? null;
  const [cols, rows] = spanOf(keys[payload.key]);
  const srcs = isCells(p) ? p.cells : p ? [view === "active" && p.active ? p.active : p.normal] : [];
  return (
    <div className="deck-ghost" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
      {Array.from({ length: cols * rows }, (_, j) => (srcs[j] ? <img key={j} src={srcs[j]} alt="" /> : <i key={j} className="deck-ghost-empty" />))}
    </div>
  );
}
