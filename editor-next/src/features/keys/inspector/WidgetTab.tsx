// Aba Widget (no lugar da Aparência quando a tecla é um widget): o tamanho (só os que o widget tem; os que
// passam da borda ficam apagados), as opções declaradas pelo widget, as cores da peça inteira e "editar tecla
// por tecla". Mesmas regras do editor atual (widgetLook, optionRow, detachCard).
import { CircleAlert, Unlink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { IconPicker } from "@/components/IconPicker";
import { SizeTile } from "@/components/Library";
import { Segmented } from "@/components/Segmented";
import { Select } from "@/components/Select";
import { Swatches, useKeySwatches } from "@/components/Swatches";
import { Switch } from "@/components/Switch";
import { useT } from "@/core/i18n";
import { isObj, type Obj } from "@/core/obj";
import { useSchema } from "@/core/queries";
import { useConfig } from "@/core/store/config";
import { sizeColsRows, widgetDefs } from "@/features/keys/actions";
import { GlyphCard, Hint } from "@/features/keys/inspector/LookTab";
import { WidgetThumb } from "@/features/keys/WidgetThumb";
import { footprint, pageKeysOf, type KeySpec } from "@/features/keys/model";
import { useThumbs } from "@/features/keys/thumbs";
import { ValueSelect } from "@/features/keys/ValueSelect";
import { countReplaced, optionValues, useWidgetOps } from "@/features/keys/widgetOps";

const Label = ({ children }: { children: ReactNode }) => <span>{children}</span>;

export function WidgetTab({ page, k, spec }: { page: string; k: string; spec: KeySpec }) {
  const t = useT();
  const schema = useSchema().data;
  const cfg = useConfig((s) => s.cfg);
  const ops = useWidgetOps(page);
  const d = widgetDefs(schema, cfg)[String(spec.widget)];

  if (!d) {
    return (
      <div className="grid gap-6 p-4">
        <div className="flex items-start gap-2.5 rounded-md bg-danger-bg px-3 py-2.5 text-sm text-fg-label">
          <Icon icon={CircleAlert} className="mt-px text-fg-subtle" />
          <span className="min-w-50 flex-1">{t("This widget isn't available anymore (the plugin was turned off or removed). Turn the plugin back on, or remove the key.")}</span>
        </div>
        <DetachCard onDetach={() => void ops.detach(k)} />
      </div>
    );
  }

  const sizes = Object.keys(d.sizes as Obj);
  const keys = pageKeysOf(cfg, page);
  const opts = ((d.options as Obj[] | undefined) ?? []).filter((o) => o.name !== "id");
  const colors = isObj(spec.colors) ? spec.colors : null;
  const [sizeRows, sizeCols] = String(spec.size ?? "1x1").split("x").map(Number);

  return (
    <div className="grid gap-6 p-4">
      <section className="flex flex-col gap-2.5">
        <Label>{t("Size")}</Label>
        <SizeTiles page={page} k={k} spec={spec} sizes={sizes} label={String(d.label)} keys={keys} onPick={(size) => ops.setSize(k, size)} />
        {sizes.length > 1 && <Hint>{t("Only the sizes this widget has. The options stay the same when you switch.")}</Hint>}
      </section>

      {opts.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <Label>{t("Options")}</Label>
          {opts.map((o) => (
            <OptionRow key={String(o.name)} o={o} value={optionValues(d, spec)[String(o.name)]} onChange={(v) => void ops.setOption(k, o, v)} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2.5">
        <Label>{t("Colors")}</Label>
        <Segmented
          variant="pills"
          label={t("Colors")}
          value={colors ? "mine" : "widget"}
          onChange={(m) => ops.setColors(k, m === "mine" ? { bg: "#1d2330", fg: "#ffffff" } : null)}
          options={[
            { value: "widget", label: t("From the widget") },
            { value: "mine", label: t("My colors") },
          ]}
          className="self-start"
        />
        {colors && <MyColors colors={colors} onChange={(c) => ops.setColors(k, c)} keys={(sizeRows || 1) * (sizeCols || 1)} />}
      </section>

      <DetachCard onDetach={() => void ops.detach(k)} />
    </div>
  );
}

function SizeTiles(props: { page: string; k: string; spec: KeySpec; sizes: string[]; label: string; keys: Record<string, KeySpec>; onPick: (size: string) => void }) {
  const { k, spec, sizes, label, keys, onPick } = props;
  const t = useT();
  const item = (size: string) => ({ widget: String(spec.widget), size, options: isObj(spec.options) ? spec.options : null, colors: isObj(spec.colors) ? spec.colors : null });
  const srcs = useThumbs(sizes.map(item));
  return (
    <div className="flex flex-wrap gap-2">
      {sizes.map((size) => {
        const [cols, rows] = sizeColsRows(size);
        const cells = footprint(k, cols, rows);
        const replaced = cells ? countReplaced(keys, cells, k) : 0;
        const note = !cells ? t("goes past the edge") : replaced && size !== spec.size ? (replaced === 1 ? t("replaces 1 key") : t("replaces {0} keys", [replaced])) : undefined;
        const sizeLabel = size.replace("x", "×");
        return (
          <SizeTile
            key={size}
            label={sizeLabel}
            rows={rows}
            unit={22}
            pressed={size === spec.size}
            disabled={!cells}
            {...(note ? { note } : {})}
            title={t("{0} in {1}", [label, sizeLabel])}
            onClick={() => size !== spec.size && onPick(size)}
            className="min-w-16 px-2.25 pt-2.25 pb-1.75"
          >
            <WidgetThumb srcs={srcs(item(size))} cols={cols} rows={rows} unit={22} dim={!cells} />
          </SizeTile>
        );
      })}
    </div>
  );
}

/** Uma opção do widget, com o controle do tipo dela (escolha, sim/não, número, cor, ícone, valor, texto). */
function OptionRow({ o, value, onChange }: { o: Obj; value: unknown; onChange: (v: unknown) => void }) {
  const keySwatches = useKeySwatches();
  const [picker, setPicker] = useState(false);
  const label = String(o.label ?? o.name);
  const choices = (o.choices as [unknown, string][] | undefined) ?? [];
  const idx = (v: unknown) => choices.findIndex(([c]) => JSON.stringify(c) === JSON.stringify(v));
  let control: ReactNode;
  switch (o.kind) {
    case "bool":
      return <Switch label={label} checked={!!value} onChange={onChange} />;
    case "choice":
      control =
        choices.length <= 3 ? (
          <Segmented
            variant="pills"
            label={label}
            value={String(idx(value ?? "") >= 0 ? idx(value ?? "") : 0)}
            onChange={(i) => onChange(choices[Number(i)]?.[0])}
            options={choices.map(([, l], i) => ({ value: String(i), label: l }))}
            className="justify-self-start"
          />
        ) : (
          <Select
            aria-label={label}
            size="sm"
            value={String(Math.max(0, idx(value)))}
            onChange={(i) => onChange(choices[Number(i)]?.[0])}
            options={choices.map(([, l], i) => ({ value: String(i), label: l }))}
            className="w-auto justify-self-start"
          />
        );
      break;
    case "number":
      control = (
        <TextInput
          type="number"
          step="any"
          value={value === null || value === undefined ? "" : String(value)}
          placeholder={o.default !== undefined ? String(o.default) : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          aria-label={label}
        />
      );
      break;
    case "color":
      control = <Swatches label={label} value={typeof value === "string" ? value : null} onChange={onChange} colors={keySwatches} />;
      break;
    case "glyph":
      control = (
        <>
          <GlyphCard icon={{ lucide: typeof value === "string" && value ? value : "circle" }} onChoose={() => setPicker(true)} />
          <IconPicker open={picker} onOpenChange={setPicker} onPick={onChange} />
        </>
      );
      break;
    case "value":
      control = <ValueSelect value={typeof value === "string" ? value : null} onPick={onChange} {...(Array.isArray(o.kinds) ? { kinds: o.kinds as string[] } : {})} label={label} />;
      break;
    default:
      control = (
        <TextInput value={value === null || value === undefined ? "" : String(value)} placeholder={String(o.placeholder ?? "")} onChange={(e) => onChange(e.target.value || null)} aria-label={label} />
      );
  }
  return (
    <div className="grid grid-cols-opt items-center gap-2.5">
      <span className="text-sm font-medium text-fg-muted">{label}</span>
      {control}
    </div>
  );
}

function MyColors({ colors, onChange, keys }: { colors: Obj; onChange: (c: Obj) => void; keys: number }) {
  const t = useT();
  const keySwatches = useKeySwatches();
  const fg = [
    { value: "#ffffff", label: t("White") },
    { value: "#eceef2", label: t("Light gray") },
    { value: "#F5A524", label: t("Orange") },
    { value: "#000000", label: t("Black") },
  ];
  return (
    <>
      <span className="text-sm text-fg-subtle">{t("Background")}</span>
      <Swatches label={t("Background")} value={typeof colors.bg === "string" ? colors.bg : "#1d2330"} onChange={(c) => onChange({ ...colors, bg: c })} colors={keySwatches} />
      <span className="text-sm text-fg-subtle">{t("Text and icon")}</span>
      <Swatches label={t("Text and icon")} value={typeof colors.fg === "string" ? colors.fg : "#ffffff"} onChange={(c) => onChange({ ...colors, fg: c })} colors={fg} />
      <Hint>{t("They apply to all {0} keys of the widget.", [keys])}</Hint>
    </>
  );
}

function DetachCard({ onDetach }: { onDetach: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-sunken p-3.5">
      <b>{t("Want something the options don't have?")}</b>
      <Button icon={Unlink} onClick={onDetach} className="self-start">
        {t("Edit key by key")}
      </Button>
      <Hint>{t("The widget becomes a regular block: you change each key the way you want, but it stops having options and getting improvements. You can undo it.")}</Hint>
    </div>
  );
}
