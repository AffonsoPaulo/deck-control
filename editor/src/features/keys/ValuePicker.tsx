// Escolher um valor para pôr no texto (o openValuePicker do editor atual): busca, os valores por grupo com o
// valor de agora à direita, e para hora/minuto/segundo/dia o jeito de mostrar (05 ou 5). Duplo clique ou Enter
// insere.
import { useRef, useState } from "react";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/Field";
import { Segmented } from "@/components/Segmented";
import { Sheet, SheetHead } from "@/components/Sheet";
import { useT } from "@/core/i18n";
import { norm } from "@/core/icons/lucide";
import { useLiveValues, useValueDefs, valueNow, type ValueDef } from "@/features/keys/values";

interface ValuePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (id: string, fmt: string) => void;
  kinds?: string[];
}

export function ValuePicker({ open, onOpenChange, onPick, kinds }: ValuePickerProps) {
  const t = useT();
  const defs = useValueDefs();
  const live = useLiveValues(open);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [fmt, setFmt] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQ("");
      setSelected(null);
      setFmt("");
    }
  }
  const search = useRef<HTMLInputElement>(null);
  const nq = norm(q);
  const groups = new Map<string, ValueDef[]>();
  for (const v of defs) {
    if (kinds && !kinds.includes(v.kind)) continue;
    if (nq && !norm(`${v.label} ${v.id} ${v.group}`).includes(nq)) continue;
    groups.set(v.group, [...(groups.get(v.group) ?? []), v]);
  }
  const sel = defs.find((d) => d.id === selected);
  const done = (id = selected) => {
    if (!id) return;
    onOpenChange(false);
    onPick(id, fmt);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={t("Choose a value")} initialFocus={search} className="w-115 gap-0 overflow-hidden p-0">
      <div
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={(e) => {
          if (e.key === "Enter" && selected) {
            e.preventDefault();
            done();
          }
        }}
      >
        <div className="pt-4 pr-3.5 pb-0 pl-5">
          <SheetHead>
            <h2 className="m-0 flex-1 text-lg font-bold">{t("Choose a value")}</h2>
          </SheetHead>
        </div>
        <div className="px-4">
          <TextInput ref={search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search (e.g.: hour, scene, temperature)")} aria-label={t("Search values")} />
        </div>
        <p className="m-0 px-5 pt-2 pb-1 text-xs leading-4.25 text-fg-subtle">{t("On the right, the value right now. Plugins can add their own.")}</p>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto px-2.5 pt-1 pb-2.5 scrollbar-stable">
          {[...groups.entries()].map(([g, items]) => (
            <div key={g}>
              <div className="px-2.5 pt-2.5 pb-1 text-sm font-bold text-fg-label">{g}</div>
              {items.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={selected === v.id}
                  onClick={() => {
                    setSelected(v.id);
                    setFmt("");
                  }}
                  onDoubleClick={() => done(v.id)}
                  className="flex min-h-control-2xl w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-fg hover:bg-sunken aria-pressed:bg-raised aria-pressed:inset-ring aria-pressed:inset-ring-accent focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <b className="text-base font-semibold">{v.label}</b>
                    <small className="text-xs text-fg-subtle">{v.id}</small>
                  </span>
                  <span className="inline-flex h-control-xs items-center rounded-sm bg-border px-2 text-sm font-semibold whitespace-nowrap">{valueNow(defs, live, v.id)}</span>
                </button>
              ))}
            </div>
          ))}
          {groups.size === 0 && <p className="mt-3 mb-0 px-2.5 text-xs text-fg-subtle">{t("No values found.")}</p>}
        </div>
        <div className="flex flex-col gap-2.5 border-t border-border bg-field px-4 pt-3 pb-4">
          {sel && /^clock\.(hour|minute|second|day)$/.test(sel.id) && (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-sm text-fg-subtle">{t("How to show")}</span>
              <Segmented
                variant="pills"
                label={t("How to show")}
                value={fmt}
                onChange={setFmt}
                options={[
                  { value: "", label: t("Two digits (05)") },
                  { value: "nz", label: t("No zero (5)") },
                ]}
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
            <Button variant="primary" disabled={!selected} onClick={() => done()}>
              {selected ? t("Insert {0}", [sel?.label ?? selected]) : t("Insert")}
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
