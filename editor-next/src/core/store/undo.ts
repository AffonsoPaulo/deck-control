// O botão "Desfazer" dos avisos (o undo: true do toast do editor atual).
import { Undo2 } from "lucide-react";
import { useConfig } from "@/core/store/config";
import type { ToastButton } from "@/core/toast";

export const undoButton = (t: (s: string) => string): ToastButton => ({
  label: t("Undo"),
  icon: Undo2,
  run: () => useConfig.getState().undo(),
});
