// Arrastar e soltar na grade (o único lugar que conhece o @dnd-kit/react, que está em 0.x: se a API mudar, muda
// só aqui). O alvo é sempre uma tecla da grade (a do canto, num bloco); a casa exata sai do ponto onde soltou
// (cellAt), para a peça grande encaixar onde o ponteiro está.
//
// Teclado: Espaço pega a tecla, as setas andam uma tecla por vez, Espaço/Enter solta, Esc desiste. Enter sozinho
// continua escolhendo a tecla (como no editor atual).
//
// Arquivo do Windows (imagem arrastada do Explorer) não passa por aqui: é o dragover/drop nativo, na tecla.
import { DragDropProvider, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable } from "@dnd-kit/react";
import { useCallback, useMemo, type ReactNode } from "react";
import type { DragPayload } from "@/features/keys/model";

export interface Pitch {
  x: number;
  y: number;
}

interface DeckDndProps {
  children: ReactNode;
  /** Quanto anda uma seta no arrastar pelo teclado (uma tecla). */
  pitch: Pitch;
  /** Soltou `payload` na tecla `target`, no ponto (x, y) da tela. */
  onDrop: (payload: DragPayload, target: string, point: { x: number; y: number }) => void;
  /** A peça que acompanha o ponteiro. */
  ghost: (payload: DragPayload) => ReactNode;
}

export function DeckDnd({ children, pitch, onDrop, ghost }: DeckDndProps) {
  // o passo do teclado só vale configurado aqui, no provedor (na tecla, o sensor só serve para começar)
  const sensors = useMemo(
    () => [PointerSensor, KeyboardSensor.configure({ offset: { x: pitch.x, y: pitch.y }, keyboardCodes: KEYBOARD })],
    [pitch.x, pitch.y],
  );
  return (
    <DragDropProvider
      sensors={sensors}
      onDragEnd={(e) => {
        const { source, target, position } = e.operation;
        if (e.canceled || !source || !target) return;
        onDrop(source.data as DragPayload, String(target.id), position.current);
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>{(source) => ghost(source.data as DragPayload)}</DragOverlay>
    </DragDropProvider>
  );
}

/** A tecla como peça arrastável (se `payload`) e como lugar para soltar. */
export function useKeyDnd(key: string, payload: DragPayload | null) {
  const drag = useDraggable({ id: `key:${key}`, data: payload ?? { kind: "key", key }, disabled: payload === null });
  const drop = useDroppable({ id: key });
  const { ref: dragRef } = drag;
  const { ref: dropRef } = drop;
  const ref = useCallback(
    (el: Element | null) => {
      dragRef(el);
      dropRef(el);
    },
    [dragRef, dropRef],
  );
  return { ref, isDragging: drag.isDragSource, isOver: drop.isDropTarget };
}

const KEYBOARD = {
  start: ["Space"],
  cancel: ["Escape"],
  end: ["Space", "Enter", "Tab"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
};
