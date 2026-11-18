// "O que faz" numa área maior (o renderExpanded do editor atual): no lugar do Deck e do inspetor, com a biblioteca
// ao lado. Clicar numa ação da biblioteca põe um passo no fim de "ao apertar"; Esc (fora de um campo) volta
// (em shortcuts.ts).
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/Button";
import { useT } from "@/core/i18n";
import { normalizeIcon } from "@/core/obj";
import { useUi } from "@/core/store/ui";
import { KeyTools } from "@/features/keys/inspector/Inspector";
import { DoTab } from "@/features/keys/logic/DoTab";
import type { KeySpec } from "@/features/keys/model";
import { isCells, type KeyPreview } from "@/features/keys/previews";

export function ExpandedView({ page, k, spec, preview }: { page: string; k: string; spec: KeySpec; preview: KeyPreview }) {
  const t = useT();
  const go = useUi((s) => s.go);
  const back = () => go({ expanded: false });
  const icon = normalizeIcon(spec.icon);
  const thumb = isCells(preview) ? preview.cells[0] : preview?.normal;
  const title = (typeof icon.text === "string" && icon.text ? icon.text : t("Key {0}", [k])).replace(/\n/g, " ");
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface">
      <div className="flex flex-none items-center gap-3.5 border-b border-border bg-surface py-3.5 pr-5 pl-6">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={back}>
          {t("Back to Deck")}
        </Button>
        <span aria-hidden className="h-7 w-px bg-border" />
        {thumb ? <img className="deck-insp-thumb deck-insp-thumb-sm" src={thumb} alt="" /> : <span className="deck-insp-thumb deck-insp-thumb-sm" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg leading-5.5 font-bold text-fg">{title}</div>
          <small className="block text-xs leading-4 text-fg-subtle">{t("Key {0}, page {1}", [k, page])}</small>
        </div>
        <KeyTools page={page} k={k} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-7 scrollbar-stable">
        <DoTab page={page} k={k} spec={spec} wide />
      </div>
    </main>
  );
}
