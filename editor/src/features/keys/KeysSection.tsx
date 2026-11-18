// Seção Teclas: a biblioteca (esquerda), o palco com as páginas e o Deck (meio) e o inspetor (direita); na visão
// ampliada, "O que faz" ocupa o meio e a direita. O arrastar envolve tudo: as peças saem da biblioteca e caem no
// Deck ou numa lista de passos.
import { useEffect } from "react";
import { useT } from "@/core/i18n";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { ExpandedView } from "@/features/keys/ExpandedView";
import { useDeckState } from "@/features/keys/deckState";
import { DeckDnd } from "@/features/keys/dnd";
import { useDeckDrop } from "@/features/keys/drop";
import { Ghost } from "@/features/keys/Ghost";
import { Inspector } from "@/features/keys/inspector/Inspector";
import { LibraryPanel } from "@/features/keys/LibraryPanel";
import { pageKeysOf, pieceSize, spanOf, type DragPayload } from "@/features/keys/model";
import { useCurrentPage } from "@/features/keys/currentPage";
import { usePagePreviews } from "@/features/keys/previews";
import { useKeyShortcuts } from "@/features/keys/shortcuts";
import { Stage } from "@/features/keys/Stage";
import { keyText } from "@/features/keys/keys";

export function KeysSection() {
  const page = useCurrentPage();
  if (page === null) return null;
  return <KeysWorkspace page={page} />;
}

function KeysWorkspace({ page }: { page: string }) {
  const t = useT();
  const { size, gapX, gapY } = useDeckState();
  const { onMove, onDrop } = useDeckDrop(page);
  const previews = usePagePreviews(page);
  useKeyShortcuts(page);
  // a visão ampliada só existe com uma tecla que tem algo
  const k = useUi((s) => s.key);
  const spec = useConfig((s) => (k ? pageKeysOf(s.cfg, page)[k] : undefined));
  const wantExpanded = useUi((s) => s.expanded);
  const expanded = wantExpanded && !!k && !!spec;
  // a tecla sumiu (apagada, ou outra escolhida vazia): sai da visão ampliada de vez, como no atual; senão ela
  // voltaria sozinha ao escolher outra tecla
  useEffect(() => {
    if (wantExpanded && !expanded) useUi.getState().go({ expanded: false });
  }, [wantExpanded, expanded]);
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
        {expanded && k && spec ? (
          <ExpandedView page={page} k={k} spec={spec} preview={previews?.[Number(k) - 1] ?? null} />
        ) : (
          <>
            <Stage page={page} />
            <Inspector page={page} previews={previews} />
          </>
        )}
      </div>
    </DeckDnd>
  );
}
