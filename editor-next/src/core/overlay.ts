// Quantos painéis por cima estão abertos (menu, confirmação, diálogo). Com algum aberto, os atalhos globais
// (Ctrl+Z, Ctrl+Y) ficam quietos, como no editor atual: o Esc e as setas são do painel.
import { useEffect } from "react";
import { create } from "zustand";

interface OverlayStore {
  open: number;
}

export const useOverlays = create<OverlayStore>()(() => ({ open: 0 }));

export const anyOverlayOpen = (): boolean => useOverlays.getState().open > 0;

/** Registra um painel enquanto `isOpen` for verdadeiro. */
export function useOverlay(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    useOverlays.setState((s) => ({ open: s.open + 1 }));
    return () => useOverlays.setState((s) => ({ open: Math.max(0, s.open - 1) }));
  }, [isOpen]);
}
