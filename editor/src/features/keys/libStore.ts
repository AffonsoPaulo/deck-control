// Como a pessoa deixou a biblioteca: a aba (Ações ou Widgets), os grupos abertos, o filtro de origem e os widgets
// abertos (com os tamanhos à mostra). Fica no navegador, com chave própria: nunca as do editor atual
// (d6-lib-open, d6-lib-tab), que é a mesma origem.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type LibTab = "actions" | "widgets";

interface LibStore {
  tab: LibTab;
  open: string[];
  origin: string; // "all" | "app" | "mine" | id do plugin
  widgetOpen: string[]; // não persiste: some ao recarregar, como no atual
  setTab: (tab: LibTab) => void;
  toggle: (group: string) => void;
  openGroup: (group: string) => void;
  setOrigin: (origin: string) => void;
  toggleWidget: (id: string) => void;
}

const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export const useLib = create<LibStore>()(
  persist(
    (set) => ({
      tab: "actions",
      open: ["Keyboard and text"],
      origin: "all",
      widgetOpen: [],
      setTab: (tab) => set({ tab }),
      toggle: (group) => set((s) => ({ open: flip(s.open, group) })),
      openGroup: (group) => set((s) => (s.open.includes(group) ? s : { open: [...s.open, group] })),
      setOrigin: (origin) => set({ origin }),
      toggleWidget: (id) => set((s) => ({ widgetOpen: flip(s.widgetOpen, id) })),
    }),
    {
      name: "deck-next-lib",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ tab: s.tab, open: s.open }),
    },
  ),
);
