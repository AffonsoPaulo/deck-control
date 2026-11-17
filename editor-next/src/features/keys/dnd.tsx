// Arrastar e soltar na seção Teclas (o único lugar que conhece o @dnd-kit/react, que está em 0.x: se a API mudar,
// muda só aqui). Peças: as teclas da grade e os itens da biblioteca. Alvos: as teclas da grade (a do canto, num
// bloco); a casa exata sai do ponto onde o ponteiro está (cellAt), para a peça grande encaixar ali.
//
// Teclado: Espaço pega, as setas andam uma tecla por vez, Espaço/Enter solta, Esc desiste. Enter sozinho continua
// escolhendo a tecla (como no editor atual).
//
// O dnd-kit guarda a primeira versão das funções de mover e soltar: elas leem o estado na hora, nunca o do render.
//
// Arquivo do Windows (imagem arrastada do Explorer) não passa por aqui: é o dragover/drop nativo, na tecla.
import { Accessibility } from "@dnd-kit/dom";
import { DragDropProvider, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable } from "@dnd-kit/react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/core/i18n";
import type { DragPayload } from "@/features/keys/model";

export interface Pitch {
  x: number;
  y: number;
}

export interface DragPoint {
  payload: DragPayload;
  target: string | null; // a tecla debaixo da peça (null = fora da grade, ou desistiu)
  x: number;
  y: number;
}

interface DeckDndProps {
  children: ReactNode;
  /** Quanto anda uma seta no arrastar pelo teclado (uma tecla). */
  pitch: Pitch;
  /** A peça andou (para acender as casas onde ela cairia). */
  onMove: (p: DragPoint) => void;
  /** Soltou (target null = fora da grade ou desistiu). */
  onDrop: (p: DragPoint) => void;
  /** A peça que acompanha o ponteiro. */
  ghost: (payload: DragPayload) => ReactNode;
  /** O tamanho da peça (a caixa que o dnd-kit usa para achar o alvo no arrastar pelo teclado). */
  ghostSize: (payload: DragPayload) => { width: number; height: number };
  /** Pode começar? (tecla vazia não sai do lugar, mas continua clicável e sem "desativada" para o leitor). */
  canDrag: (payload: DragPayload) => boolean;
  /** O nome da peça nos anúncios para o leitor de tela. */
  nameOf: (payload: DragPayload) => string;
}

interface Op {
  source: { data: unknown } | null;
  target: { id: unknown } | null;
  position: { current: { x: number; y: number } };
}
const sized = ({ width, height }: { width: number; height: number }) => ({ width, height, maxWidth: width, maxHeight: height });

const point = (op: Op): DragPoint | null =>
  op.source ? { payload: op.source.data as DragPayload, target: op.target ? String(op.target.id) : null, ...op.position.current } : null;

export function DeckDnd({ children, pitch, onMove, onDrop, ghost, ghostSize, canDrag, nameOf }: DeckDndProps) {
  const t = useT();
  const [active, setActive] = useState<DragPayload | null>(null);
  // o passo do teclado só vale configurado aqui, no provedor (na peça, o sensor só serve para começar)
  const sensors = useMemo(
    () => [PointerSensor, KeyboardSensor.configure({ offset: { x: pitch.x, y: pitch.y }, keyboardCodes: KEYBOARD })],
    [pitch.x, pitch.y],
  );
  // os anúncios para o leitor de tela, no idioma do editor, com o nome da peça e o número da tecla
  const plugins = useMemo(() => {
    interface Ev {
      operation: Op;
      canceled?: boolean;
    }
    const name = (op: Op) => (op.source ? nameOf(op.source.data as DragPayload) : "");
    const a11y = Accessibility.configure({
      screenReaderInstructions: {
        draggable: t(
          "To pick up a key or a piece, press the space bar. Use the arrow keys to move it one key at a time. Press space again to drop it, or Escape to cancel.",
        ),
      },
      announcements: {
        dragstart: (e: unknown) => t("Picked up {0}.", [name((e as unknown as Ev).operation)]),
        dragover: (e: unknown) => {
          const op = (e as unknown as Ev).operation;
          return op.target ? t("{0} is over key {1}.", [name(op), String(op.target.id)]) : t("{0} is outside the Deck.", [name(op)]);
        },
        dragend: (e: unknown) => {
          const ev = e as unknown as Ev;
          return ev.canceled || !ev.operation.target
            ? t("{0}: moving canceled.", [name(ev.operation)])
            : t("{0} was dropped on key {1}.", [name(ev.operation), String(ev.operation.target.id)]);
        },
      },
    });
    return (defaults: unknown[]) => defaults.map((p) => (p === Accessibility ? a11y : p));
  }, [t, nameOf]);
  return (
    <DragDropProvider
      sensors={sensors}
      plugins={plugins as never}
      onBeforeDragStart={(e) => {
        const src = (e.operation as unknown as Op).source;
        if (src && !canDrag(src.data as DragPayload)) e.preventDefault();
      }}
      onDragStart={(e) => setActive(((e.operation as unknown as Op).source?.data as DragPayload | undefined) ?? null)}
      onDragMove={(_e, manager) => {
        const p = point(manager.dragOperation as unknown as Op);
        if (p) onMove(p);
      }}
      onDragOver={(e) => {
        const p = point(e.operation as unknown as Op);
        if (p) onMove(p);
      }}
      onDragEnd={(e) => {
        setActive(null);
        const p = point(e.operation as unknown as Op);
        if (p) onDrop(e.canceled ? { ...p, target: null } : p);
      }}
    >
      {children}
      {/* o CSS do dnd-kit limita a caixa ao tamanho da origem (max-width/max-height): a peça diz o dela */}
      <DragOverlay dropAnimation={null} style={active ? sized(ghostSize(active)) : {}}>
        {(source) => ghost(source.data as DragPayload)}
      </DragOverlay>
    </DragDropProvider>
  );
}

/** A tecla como peça arrastável e como lugar para soltar. Tecla vazia: quem barra é o canDrag do provedor (com
 * `disabled`, o dnd-kit marcaria a tecla como desativada para o leitor de tela). */
export function useKeyDnd(key: string) {
  const data = useMemo<DragPayload>(() => ({ kind: "key", key }), [key]);
  const drag = useDraggable({ id: `key:${key}`, data });
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

/** Um item da biblioteca como peça arrastável (só sai; não recebe nada). */
export function useLibDrag(id: string, payload: DragPayload) {
  const drag = useDraggable({ id: `lib:${id}`, data: payload });
  return { ref: drag.ref, isDragging: drag.isDragSource };
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
