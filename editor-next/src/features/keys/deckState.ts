// O que a grade e a biblioteca dividem durante um arrasto (fora do config e da URL): a grade na tela e as
// medidas de uma tecla (a peça que acompanha o ponteiro tem o tamanho de verdade), e onde a peça vai cair
// (as casas acesas, as que vão ser substituídas, a que não cabe e o recado embaixo do Deck).
import { create } from "zustand";

export interface Foot {
  cells: string[]; // casas que a peça vai ocupar
  replace: string[]; // dessas, as que já têm tecla (a tecla do canto, num bloco)
  bad: string | null; // a casa onde ela não cabe (passa da borda)
  tip: string | null; // "Relógio 2×2: substitui 1 tecla"
}

export const NO_FOOT: Foot = { cells: [], replace: [], bad: null, tip: null };

interface DeckState {
  grid: HTMLElement | null;
  size: number; // lado de uma tecla, em px
  gapX: number;
  gapY: number;
  foot: Foot;
}

export const useDeckState = create<DeckState>()(() => ({ grid: null, size: 84, gapX: 24, gapY: 26, foot: NO_FOOT }));

/** Mede a grade (uma tecla, o vão) e guarda; chamado pela grade quando muda de tamanho. */
export function measureGrid(grid: HTMLElement): void {
  const a = grid.querySelector<HTMLElement>('[data-cell="1"]')?.getBoundingClientRect();
  const b = grid.querySelector<HTMLElement>('[data-cell="2"]')?.getBoundingClientRect();
  const c = grid.querySelector<HTMLElement>('[data-cell="6"]')?.getBoundingClientRect();
  if (!a || !b || !c || !a.width) return;
  useDeckState.setState({ grid, size: a.width, gapX: b.left - a.right, gapY: c.top - a.bottom });
}
