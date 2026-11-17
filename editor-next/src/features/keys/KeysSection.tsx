// Seção Teclas. Nesta parte: o palco (páginas e o Deck). A biblioteca e o inspetor ainda são do editor atual.
import { SectionPlaceholder } from "@/app/SectionPlaceholder";
import type { Place } from "@/core/hash";
import { Stage } from "@/features/keys/Stage";

export function KeysSection({ place }: { place: Place }) {
  return (
    <div className="flex min-h-0 flex-1">
      <Stage />
      <aside className="flex w-90 flex-none border-l border-border">
        <SectionPlaceholder place={place} />
      </aside>
    </div>
  );
}
