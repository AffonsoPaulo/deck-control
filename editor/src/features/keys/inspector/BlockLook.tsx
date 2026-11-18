// Aparência do bloco (várias teclas juntas): distribuir (cada tecla mostra uma parte, editada como tecla de
// informação) ou uma imagem contínua que atravessa as telas; as regras; separar as teclas; salvar como widget.
// Mesmas regras do editor atual (blockLook, splitBlock, saveAsWidget).
import { Bookmark, Ungroup, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Field, TextInput } from "@/components/Field";
import { IconPicker, useLucideIndex } from "@/components/IconPicker";
import { Segmented } from "@/components/Segmented";
import { Sheet, SheetHead } from "@/components/Sheet";
import { useT } from "@/core/i18n";
import { luChar, norm } from "@/core/icons/lucide";
import { clone, isObj, normalizeIcon, type Obj } from "@/core/obj";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { undoButton } from "@/core/store/undo";
import { toast } from "@/core/toast";
import { Hint, ImageCard } from "@/features/keys/inspector/LookTab";
import { InfoLook, Lbl, RulesSection } from "@/features/keys/inspector/InfoLook";
import { draftKeys, keyText, uploadImage } from "@/features/keys/keys";
import { useLib } from "@/features/keys/libStore";
import { footprint, spanOf, type KeySpec } from "@/features/keys/model";
import { isCells, type KeyPreview } from "@/features/keys/previews";
import { useSession } from "@/features/keys/session";

export function BlockLook({ page, k, spec, preview }: { page: string; k: string; spec: KeySpec; preview: KeyPreview }) {
  const t = useT();
  const edit = useConfig((s) => s.edit);
  const go = useUi((s) => s.go);
  const cellIdx = useSession((s) => s.cellIdx);
  const setCellIdx = useSession((s) => s.setCellIdx);
  const [saving, setSaving] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [cols, rows] = spanOf(spec);
  const n = cols * rows;
  const image = spec.mode === "image";
  const sel = Math.min(cellIdx, n - 1);
  const setKey = (fn: (s: KeySpec) => void) =>
    edit((d) => {
      const s = draftKeys(d, page)[k];
      if (s) fn(s);
    });
  const setImage = (p: string | null) =>
    setKey((s) => {
      const icon = { ...normalizeIcon(s.icon) };
      if (p) icon.image = p;
      else delete icon.image;
      s.icon = icon;
    });
  const cellPreview = isCells(preview) ? (preview.cells[sel] ?? null) : null;

  const split = () => {
    const list = footprint(k, cols, rows) ?? [k];
    const cells = Array.isArray(spec.cells) ? (spec.cells as Obj[]) : [];
    edit((d) => {
      const keys = draftKeys(d, page);
      const s = keys[k];
      if (!s) return;
      list.forEach((kk, i) => {
        if (kk !== k) keys[kk] = { icon: cells[i] ? clone(cells[i]) : {} };
      });
      if (cells[0]) s.icon = clone(cells[0]);
      for (const f of ["span", "cells", "mode"]) Reflect.deleteProperty(s, f);
    });
    go({ key: k, tab: "look" });
    toast(t("Block separated into {0} keys.", [list.length]), { undo: undoButton(t) });
  };

  return (
    <div className="grid gap-6 p-4">
      <div className="flex flex-col gap-2">
        <Lbl>{t("Block {0}", [`${rows}×${cols}`])}</Lbl>
        <Segmented
          variant="pills"
          label={t("How to show")}
          value={image ? "image" : "split"}
          className="self-start"
          onChange={(m) =>
            setKey((s) => {
              s.mode = m;
              if (m === "split" && !s.cells) s.cells = Array.from({ length: n }, () => ({}));
            })
          }
          options={[
            { value: "split", label: t("Distribute") },
            { value: "image", label: t("Continuous image") },
          ]}
        />
        <Hint>
          {image ? t("One picture crosses the screens. The app skips the frame between them, so it looks continuous.") : t("Each screen gets a whole part. Best for text and numbers.")}
        </Hint>
      </div>

      {image ? (
        <div className="flex flex-col gap-2">
          <Lbl>{t("Image")}</Lbl>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f)
                uploadImage(f)
                  .then(setImage)
                  .catch((err: unknown) => toast(t("Error sending the image: ") + (err as Error).message, { bad: true }));
            }}
          />
          {typeof normalizeIcon(spec.icon).image === "string" ? (
            <ImageCard path={String(normalizeIcon(spec.icon).image)} onChange={() => file.current?.click()} onRemove={() => setImage(null)} />
          ) : (
            <Button icon={Upload} className="self-start" onClick={() => file.current?.click()}>
              {t("Choose image")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Lbl>{t("Editing the key")}</Lbl>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, 34px)` }}>
              {Array.from({ length: n }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={i === sel}
                  aria-label={t("Key {0} of the block", [i + 1])}
                  onClick={() => setCellIdx(i)}
                  className="size-control-lg cursor-pointer rounded-md border border-border-strong bg-surface font-bold text-fg-muted aria-pressed:border-accent aria-pressed:text-fg aria-pressed:inset-ring aria-pressed:inset-ring-accent focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
          {/* como no atual: a aparência da tecla é um painel dentro do painel (recuo a mais) */}
          <div>
            <InfoLook
              key={sel}
              page={page}
              k={k}
              spec={spec}
              preview={cellPreview}
              target={{
                cell: true,
                get: (s) => {
                  const c = (Array.isArray(s.cells) ? s.cells : [])[sel];
                  return isObj(c) ? c : {};
                },
                set: (s, v) => {
                  const cells = (Array.isArray(s.cells) ? [...(s.cells as unknown[])] : []) as unknown[];
                  while (cells.length < n) cells.push({});
                  cells[sel] = v;
                  s.cells = cells;
                },
              }}
            />
          </div>
        </>
      )}

      <RulesSection page={page} k={k} spec={spec} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button icon={Ungroup} onClick={split}>
            {t("Separate keys")}
          </Button>
          {!image && (
            <Button icon={Bookmark} onClick={() => setSaving(true)}>
              {t("Save as widget")}
            </Button>
          )}
        </div>
        {!image && <Hint>{t("Save as widget: it goes to My widgets, in the library, to place again on any page.")}</Hint>}
      </div>
      <SaveAsWidget open={saving} onOpenChange={setSaving} spec={spec} />
    </div>
  );
}

/** Salvar o bloco em "Meus widgets" (config: widgets), com nome e ícone. */
function SaveAsWidget({ open, onOpenChange, spec }: { open: boolean; onOpenChange: (o: boolean) => void; spec: KeySpec }) {
  const t = useT();
  const idx = useLucideIndex(open);
  const edit = useConfig((s) => s.edit);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("layout-grid");
  const [picker, setPicker] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const input = useRef<HTMLInputElement>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(keyText(spec).trim());
      setIcon("layout-grid");
    }
  }
  const [cols, rows] = spanOf(spec);
  const save = () => {
    const label = name.trim();
    if (!label) {
      input.current?.focus();
      toast(t("Give the widget a name."), { bad: true });
      return;
    }
    edit((d) => {
      const widgets = (isObj(d.widgets) ? d.widgets : (d.widgets = {})) as Obj;
      const base = "my." + (norm(label).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "widget");
      let id = base;
      for (let n = 2; widgets[id]; n++) id = `${base}_${n}`;
      const cells = (Array.isArray(spec.cells) ? (spec.cells as Obj[]) : []).slice(0, cols * rows).map((c) => clone(c) ?? {});
      while (cells.length < cols * rows) cells.push({});
      const grid = Array.from({ length: rows }, (_, r) => cells.slice(r * cols, (r + 1) * cols));
      const w: Obj = { label, icon, sizes: { [`${rows}x${cols}`]: grid } };
      for (const m of ["action", "hold"]) if (spec[m]) w[m] = clone(spec[m]);
      widgets[id] = w;
    });
    useLib.getState().openGroup("w:mine");
    onOpenChange(false);
    toast(t("Saved in My widgets, in the library (Widgets tab)."));
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={t("Save as widget")} initialFocus={input} className="w-115 gap-0 overflow-hidden p-0">
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === input.current) save();
        }}
      >
        <div className="pt-4 pr-3.5 pl-5">
          <SheetHead>
            <h2 className="m-0 flex-1 text-lg font-bold">{t("Save as widget")}</h2>
          </SheetHead>
        </div>
        <div className="flex flex-col gap-3.5 px-5 pt-2 pb-1">
          <Field label={t("Name")}>
            {(id) => <TextInput id={id} ref={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g.: {0}", [t("Live panel")])} />}
          </Field>
          <Field label={t("Icon")} hint={t("It shows up next to the name in the library.")}>
            {(id) => (
              <Button id={id} onClick={() => setPicker(true)}>
                <span aria-hidden className="font-lucide text-(length:--icon-md) leading-none">
                  {idx ? luChar(idx, icon) : ""}
                </span>
                {t("Change")}
              </Button>
            )}
          </Field>
          <div className="flex flex-col items-start gap-2">
            <span className="text-base font-semibold text-fg-label">{t("Size")}</span>
            <span className="text-sm text-fg-subtle">{t("{0}, the size of this block", [`${rows}×${cols}`])}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 pt-4 pb-4.5">
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" onClick={save}>
            {t("Save widget")}
          </Button>
        </div>
      </div>
      <IconPicker open={picker} onOpenChange={setPicker} onPick={setIcon} />
    </Sheet>
  );
}
