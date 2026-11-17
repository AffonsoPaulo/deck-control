// Seção Teclas: a biblioteca (esquerda), o palco com as páginas e o Deck (meio) e o inspetor (direita, ainda no
// editor atual). O arrastar envolve a biblioteca e o Deck, porque as peças saem de uma e caem no outro.
import type { Place } from "@/core/hash";
import { useT } from "@/core/i18n";
import { useConfig } from "@/core/store/config";
import { useDeckState } from "@/features/keys/deckState";
import { DeckDnd } from "@/features/keys/dnd";
import { useDeckDrop } from "@/features/keys/drop";
import { Ghost } from "@/features/keys/Ghost";
import { Inspector } from "@/features/keys/inspector/Inspector";
import { LibraryPanel } from "@/features/keys/LibraryPanel";
import { pageKeysOf, pieceSize, spanOf, type DragPayload } from "@/features/keys/model";
import { usePagePreviews } from "@/features/keys/previews";
import { useKeyShortcuts } from "@/features/keys/shortcuts";
import { Stage, useCurrentPage } from "@/features/keys/Stage";
import { keyText } from "@/features/keys/keys";

export function KeysSection({ place }: { place: Place }) {
  const page = useCurrentPage();
  if (page === null) return null;
  return <KeysWorkspace page={page} place={place} />;
}

function KeysWorkspace({ page, place }: { page: string; place: Place }) {
  const t = useT();
  const { size, gapX, gapY } = useDeckState();
  const { onMove, onDrop } = useDeckDrop(page);
  const previews = usePagePreviews(page);
  useKeyShortcuts(page);
  // estas funções leem o estado na hora (o dnd-kit guarda a primeira versão delas)
  const keysNow = () => pageKeysOf(useConfig.getState().cfg, page);
  const ghostSize = (p: DragPayload) => {
    if (p.kind === "step") return { width: 260, height: 40 }; // passo: a frase, não uma tecla
    const [cols, rows] = p.kind === "key" ? spanOf(keysNow()[p.key]) : pieceSize(p);
    const s = useDeckState.getState();
    return { width: cols * s.size + (cols - 1) * s.gapX, height: rows * s.size + (rows - 1) * s.gapY };
  };
  const canDrag = (p: DragPayload) => p.kind !== "key" || !!keysNow()[p.key];
  const nameOf = (p: DragPayload) => {
    if (p.kind !== "key") return p.label;
    const text = keyText(keysNow()[p.key]);
    return text ? `${t("Key {0}", [p.key])} (${text})` : t("Key {0}", [p.key]);
  };
  return (
    <DeckDnd
      pitch={{ x: size + gapX, y: size + gapY }}
      onMove={onMove}
      onDrop={onDrop}
      ghost={(p) => <Ghost payload={p} page={page} previews={previews} />}
      ghostSize={ghostSize}
      canDrag={canDrag}
      nameOf={nameOf}
    >
      <div className="flex min-h-0 flex-1">
        <LibraryPanel page={page} />
        <Stage page={page} />
        <Inspector page={page} previews={previews} place={place} />
      </div>
    </DeckDnd>
  );
}
