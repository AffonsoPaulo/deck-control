// Escolher uma ação numa folha (o #actionSheet do editor atual): busca e as ações por categoria, com a primeira
// frase da ajuda embaixo do nome.
import { useRef, useState } from "react";
import { TextInput } from "@/components/Field";
import { Chip, catStyle } from "@/components/Library";
import { Sheet, SheetHead } from "@/components/Sheet";
import { useT } from "@/core/i18n";
import { norm } from "@/core/icons/lucide";
import { useSchema } from "@/core/queries";
import { actionDefs, groupOf, groupedActions, groupsOf, iconOf } from "@/features/keys/actions";

interface ActionPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (type: string) => void;
  current?: string | null;
}

export function ActionPicker({ open, onOpenChange, onPick, current }: ActionPickerProps) {
  const t = useT();
  const schema = useSchema().data;
  const [query, setQuery] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery("");
  }
  const search = useRef<HTMLInputElement>(null);
  const defs = actionDefs(schema);
  const groups = groupsOf(schema);
  const list = groupedActions(defs, groups, norm(query), norm, t);
  const pick = (type: string) => {
    onOpenChange(false);
    onPick(type);
  };
  const placeholder = t("Search actions (e.g.: scene, shortcut, mute)");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={t("Choose action")} initialFocus={search}>
      <SheetHead>
        <TextInput ref={search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="flex-1" />
      </SheetHead>
      <div className="grid min-h-0 gap-4 overflow-auto scrollbar-stable">
        {list.map(([g, items]) => (
          <section key={g.name} style={catStyle(g.color)}>
            <h3 className="m-0 mb-1.5 text-xs font-semibold text-fg-subtle">{t(g.name)}</h3>
            <div className="grid grid-cols-picker gap-1">
              {items.map(([type, d]) => (
                <button
                  key={type}
                  type="button"
                  aria-current={type === current ? "true" : undefined}
                  style={catStyle(groupOf(groups, defs, type).color)}
                  onClick={() => pick(type)}
                  className="flex cursor-pointer items-center gap-3 rounded-md p-2 text-left hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Chip name={iconOf(defs, type)} />
                  <span className="font-medium">
                    {t(d.label)}
                    {d.help && <small className="block text-xs leading-tight font-normal text-fg-subtle">{t(d.help).split(".")[0]}.</small>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {!list.length && <p className="mt-3 mb-0 text-xs text-fg-subtle">{t("No actions found.")}</p>}
      </div>
    </Sheet>
  );
}
