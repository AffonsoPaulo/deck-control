// Atalhos da seção Teclas (os do editor atual): Ctrl+C / Ctrl+V copiam e colam a tecla escolhida, Delete ou
// Backspace apaga, as setas andam entre as teclas e Esc tira a escolha. Ficam quietos digitando num campo, com
// menu, folha ou diálogo aberto, e enquanto uma peça está sendo arrastada (aí as setas são do arrastar).
import { useEffect } from "react";
import { anyOverlayOpen } from "@/core/overlay";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { useDeckState } from "@/features/keys/deckState";
import { useKeyOps } from "@/features/keys/keyOps";
import { coverMap, pageKeysOf } from "@/features/keys/model";

const typing = () => {
  const el = document.activeElement;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (el as HTMLElement).isContentEditable);
};

export function useKeyShortcuts(page: string): void {
  const ops = useKeyOps(page);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing() || anyOverlayOpen() || useDeckState.getState().dragging || e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const sel = useUi.getState().key;
      if (mod && k === "c" && sel) return ops.copy(sel);
      if (mod && k === "v" && sel) return void ops.paste(sel);
      if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        return ops.remove(sel);
      }
      const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 };
      const step = moves[e.key];
      if (step !== undefined && !mod) {
        e.preventDefault();
        const next = sel ? Number(sel) + step : 1;
        if (next < 1 || next > 15) return;
        // casa dentro de um bloco: escolhe o bloco (a tecla do canto)
        const target = coverMap(pageKeysOf(useConfig.getState().cfg, page))[String(next)]?.[0] ?? String(next);
        useUi.getState().go({ key: target, lookMode: "normal" });
        document.querySelector<HTMLElement>(`.deck-key[data-key="${target}"]`)?.focus();
        return;
      }
      if (e.key === "Escape" && sel) useUi.getState().go({ key: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ops, page]);
}
