// Aparência da tecla de informação (e de cada tecla de um bloco): texto e segunda linha com valores, ícone (nenhum,
// fixo ou vindo de um valor), fundo (cor fixa ou por faixas de um valor), barra embaixo e as regras (a primeira
// que valer muda a aparência). Mesmas regras do editor atual (infoLook, bandsEditor, bandRows, rulesSection).
import { Info, Pencil, Plus, Search, SlidersHorizontal, Split, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { IconPicker, useLucideIndex } from "@/components/IconPicker";
import { catStyle } from "@/components/Library";
import { Segmented } from "@/components/Segmented";
import { Swatches, useKeySwatches } from "@/components/Swatches";
import { Switch } from "@/components/Switch";
import { useT } from "@/core/i18n";
import { luChar } from "@/core/icons/lucide";
import { clone, isObj, normalizeIcon, type Obj } from "@/core/obj";
import { useConfig } from "@/core/store/config";
import { CondEditor } from "@/features/keys/CondEditor";
import { GlyphCard, Hint } from "@/features/keys/inspector/LookTab";
import { draftKeys } from "@/features/keys/keys";
import { ChipLabel, LogicBlock } from "@/features/keys/LogicBlock";
import { patchIcon } from "@/features/keys/look";
import type { KeySpec } from "@/features/keys/model";
import { useSession } from "@/features/keys/session";
import { TokenField } from "@/features/keys/TokenField";
import { ValueSelect } from "@/features/keys/ValueSelect";
import { firstNumber, hasTokens, useValueDefs } from "@/features/keys/values";

export const Lbl = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={["text-base font-semibold text-fg-label", className].filter(Boolean).join(" ")}>{children}</span>
);
const Sub = ({ children }: { children: ReactNode }) => <span className="text-sm text-fg-subtle">{children}</span>;

type Band = [number, string];

/** Onde a aparência mora: o ícone da própria tecla, ou uma tecla de um bloco (cells[i]). */
export interface InfoTarget {
  cell: boolean;
  get: (spec: KeySpec) => Obj;
  set: (spec: KeySpec, icon: Obj) => void;
}
const OWN: InfoTarget = { cell: false, get: (s) => normalizeIcon(s.icon), set: (s, v) => (s.icon = v) };

interface InfoLookProps {
  page: string;
  k: string;
  spec: KeySpec;
  preview: string | null;
  target?: InfoTarget;
}

export function InfoLook({ page, k, spec, preview, target = OWN }: InfoLookProps) {
  const t = useT();
  const defs = useValueDefs();
  const keySwatches = useKeySwatches();
  const edit = useConfig((s) => s.edit);
  const [picker, setPicker] = useState(false);
  const icon = target.get(spec);
  const save = (patch: Obj, tag?: string) =>
    edit((d) => {
      const s = draftKeys(d, page)[k];
      if (s) target.set(s, patchIcon(target.get(s), patch));
    }, tag);
  const tag = (f: string) => `info:${page}:${k}:${target.cell ? "cell" : "own"}:${f}`;
  const noAction = !spec.action && !spec.hold && !spec.release && !spec.double;
  const lucide = typeof icon.lucide === "string" ? icon.lucide : null;
  const iconMode = lucide ? (hasTokens(lucide) ? "value" : "fixed") : "none";
  const bg = icon.bg;
  const bar = isObj(icon.bar) ? icon.bar : null;
  const setBar = (patch: Obj) => save({ bar: { ...(bar ?? {}), ...patch } });

  return (
    <div className="grid gap-6 p-4">
      {!target.cell && noAction && (
        <div className="flex items-start gap-2.5 rounded-md bg-sunken px-3 py-2.5 text-sm leading-(--text-base--line-height) text-fg-label" style={catStyle("var(--cat-violet)")}>
          <Icon icon={Info} className="mt-px flex-none text-cat-ink" />
          <span>{t("This key only shows information. Pressing it does nothing, unless you add an action in What it does.")}</span>
        </div>
      )}
      <div className="flex items-center gap-5">
        {preview ? <img className="deck-look-img" src={preview} alt={t("Key preview")} /> : <span className="deck-look-img" />}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <Hint>{t("The preview uses the values right now (or an example, with the app closed).")}</Hint>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Lbl>{t("Text")}</Lbl>
        <TokenField value={str(icon.text)} onChange={(v) => save({ text: v }, tag("text"))} label={t("Text")} placeholder={t("e.g.: {0}", ["14:32"])} />
        <Lbl className="mt-1.5">{t("Second line")}</Lbl>
        <TokenField value={str(icon.sub)} onChange={(v) => save({ sub: v }, tag("sub"))} label={t("Second line")} placeholder={t("optional")} />
        <Hint>{t("Mix fixed text with values. The {0} button opens the list of values.", ["{ }"])}</Hint>
      </div>

      <div className="flex flex-col gap-2">
        <Lbl>{t("Icon")}</Lbl>
        <Segmented
          variant="pills"
          label={t("Icon")}
          value={iconMode}
          className="self-start"
          onChange={(m) => {
            if (m === "none") save({ lucide: null });
            else if (m === "fixed") setPicker(true);
            else {
              const first = defs.find((v) => v.kind === "icon");
              save({ lucide: first ? `{${first.id}}` : null });
            }
          }}
          options={[
            { value: "none", label: t("None##icon") },
            { value: "fixed", label: t("Fixed##icon") },
            { value: "value", label: t("From a value") },
          ]}
        />
        {iconMode === "fixed" && <GlyphCard icon={{ lucide }} onChoose={() => setPicker(true)} onRemove={() => save({ lucide: null })} />}
        {iconMode === "value" && (
          <>
            <ValueSelect value={/\{([^}|]+)/.exec(lucide ?? "")?.[1] ?? null} onPick={(v) => save({ lucide: v ? `{${v}}` : null })} kinds={["icon"]} label={t("Value with the icon")} />
            <Hint>{t("For example, the weather condition: the plugin says which icon to use.")}</Hint>
          </>
        )}
        <IconPicker open={picker} onOpenChange={setPicker} onPick={(c) => save({ lucide: c })} />
      </div>

      <div className="flex flex-col gap-2">
        <Lbl>{t("Background")}</Lbl>
        {isObj(bg) ? (
          <>
            <BandsEditor bg={bg} onChange={(v) => save({ bg: v }, tag("bg"))} label={t("Color by value")} />
            <Button size="sm" className="self-start" onClick={() => save({ bg: ((bg.bands as Band[] | undefined)?.[0]?.[1] as string | undefined) ?? "#1d2330" })}>
              {t("Use one color")}
            </Button>
          </>
        ) : (
          <>
            <Swatches label={t("Background")} value={str(bg)} onChange={(c) => save({ bg: c })} colors={keySwatches} noneLabel={t("Default")} />
            <Button
              size="sm"
              icon={SlidersHorizontal}
              className="self-start"
              onClick={() => save({ bg: { value: firstNumber(defs), bands: [[30, "#1d2330"], [80, "#3a2a12"], [100, "#b4232a"]] } })}
            >
              {t("Depending on a value")}
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Switch
          label={t("Bar at the bottom")}
          checked={!!bar}
          onChange={(on) => save({ bar: on ? { value: firstNumber(defs), min: 0, max: 100, color: "#F5A524" } : null })}
        />
        {bar && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ValueSelect value={str(bar.value)} onPick={(v) => setBar({ value: v })} kinds={["number"]} label={t("Value of the bar")} className="w-auto" />
              <Sub>{t("from")}</Sub>
              <NumberInput value={bar.min ?? 0} placeholder="0" onChange={(v) => setBar({ min: v })} label={t("from")} />
              <Sub>{t("to")}</Sub>
              <NumberInput value={bar.max ?? 100} placeholder="100" onChange={(v) => setBar({ max: v })} label={t("to")} />
            </div>
            <Segmented
              variant="pills"
              label={t("Bar color")}
              value={bar.bands ? "bands" : "one"}
              className="self-start"
              onChange={(m) => {
                const b: Obj = { ...bar };
                if (m === "bands") {
                  b.bands = [[30, "#8f98a5"], [80, "#F5A524"], [100, "#f97316"]];
                  delete b.color;
                } else {
                  b.color = ((bar.bands as Band[] | undefined)?.[1]?.[1] as string | undefined) ?? "#F5A524";
                  delete b.bands;
                }
                save({ bar: b });
              }}
              options={[
                { value: "one", label: t("One color") },
                { value: "bands", label: t("By range") },
              ]}
            />
            {bar.bands ? (
              <BandRows bands={bar.bands as Band[]} onChange={(bands) => setBar({ bands })} />
            ) : (
              <Swatches label={t("Bar color")} value={str(bar.color) ?? "#F5A524"} onChange={(c) => setBar({ color: c })} colors={keySwatches} />
            )}
          </>
        )}
      </div>

      {!target.cell && <RulesSection page={page} k={k} spec={spec} />}
    </div>
  );
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function NumberInput({ value, onChange, placeholder, label }: { value: unknown; onChange: (v: number | null) => void; placeholder: string; label: string }) {
  return (
    <TextInput
      type="number"
      step="any"
      aria-label={label}
      value={value === null || value === undefined ? "" : String(value)}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="w-17.5"
    />
  );
}

// ---------------------------------------------------------------------------- faixas

function BandsEditor({ bg, onChange, label }: { bg: Obj; onChange: (bg: Obj) => void; label: string }) {
  const t = useT();
  const bands = (bg.bands as Band[] | undefined) ?? [
    [50, "#1d2330"],
    [100, "#b4232a"],
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <Sub>{label}</Sub>
      <ValueSelect value={str(bg.value)} onPick={(v) => onChange({ ...bg, value: v, bands })} kinds={["number"]} label={t("Value")} />
      <BandRows bands={bands} onChange={(b) => onChange({ ...bg, bands: b })} />
    </div>
  );
}

/** Faixas [[até, cor], ...] em ordem crescente. */
function BandRows({ bands, onChange }: { bands: Band[]; onChange: (bands: Band[]) => void }) {
  const t = useT();
  const set = (i: number, b: Band) => onChange(bands.map((x, j) => (j === i ? b : x)));
  return (
    <div className="flex flex-col gap-1.5">
      {bands.map((b, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md bg-sunken py-1 pr-1.5 pl-2 text-sm">
          <input
            type="color"
            aria-label={t("Color")}
            value={/^#[0-9a-f]{6}$/i.test(b[1]) ? b[1] : "#888888"}
            onChange={(e) => set(i, [b[0], e.target.value])}
            className="size-6.5 cursor-pointer rounded-sm border-0 bg-transparent p-0"
          />
          <span>{i === 0 ? t("up to") : t("then up to")}</span>
          <NumberInput value={b[0]} placeholder="100" onChange={(v) => set(i, [v ?? 0, b[1]])} label={t("up to")} />
          {bands.length > 1 && <IconButton icon={X} size="sm" label={t("Remove range")} onClick={() => onChange(bands.filter((_x, j) => j !== i))} />}
        </div>
      ))}
      <Button
        size="sm"
        icon={Plus}
        className="self-start"
        onClick={() => {
          const last = bands[bands.length - 1] ?? [0, "#1d2330"];
          onChange([...bands, [Number(last[0]) + 10, last[1]]]);
        }}
      >
        {t("Range")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------- regras

export function RulesSection({ page, k, spec }: { page: string; k: string; spec: KeySpec }) {
  const t = useT();
  const idx = useLucideIndex();
  const keySwatches = useKeySwatches();
  const edit = useConfig((s) => s.edit);
  const ruleOpen = useSession((s) => s.ruleOpen);
  const setRuleOpen = useSession((s) => s.setRuleOpen);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const rules = (Array.isArray(spec.rules) ? spec.rules : []) as Obj[];
  const editRules = (fn: (rules: Obj[]) => void, tag?: string) =>
    edit((d) => {
      const s = draftKeys(d, page)[k];
      if (!s) return;
      const list = (Array.isArray(s.rules) ? s.rules : (s.rules = [])) as Obj[];
      fn(list);
      if (!list.length) delete s.rules;
    }, tag);
  const setLook = (i: number, patch: Obj, tag?: string) =>
    editRules((list) => {
      const r = list[i];
      if (r) r.icon = patchIcon(isObj(r.icon) ? r.icon : {}, patch);
    }, tag);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <Lbl>{t("Rules")}</Lbl>
        <span className="ml-2">
          <Sub>{t("optional")}</Sub>
        </span>
      </div>
      <Hint>{t("The first rule that holds changes the appearance. With none holding, the key looks like above.")}</Hint>
      {rules.map((r, i) => {
        const look = isObj(r.icon) ? r.icon : {};
        const editing = ruleOpen === `${page}:${k}:${i}`;
        const summary =
          [look.bg ? t("background {0}", [look.bg]) : null, look.lucide ? t("icon {0}", [look.lucide]) : null, look.text ? `“${String(look.text)}”` : null]
            .filter(Boolean)
            .join(", ") || t("no changes yet");
        return (
          <LogicBlock
            key={i}
            icon={Split}
            words={
              <>
                <ChipLabel>{t("If")}</ChipLabel>
                <CondEditor cond={isObj(r.if) ? r.if : {}} onChange={(c) => editRules((list) => list[i] && (list[i].if = c), `rule:${page}:${k}:${i}:if`)} />
              </>
            }
            tools={<IconButton icon={Trash2} size="sm" label={t("Remove rule")} className="text-inherit" onClick={() => editRules((list) => void list.splice(i, 1))} />}
          >
            {editing ? (
              <div className="flex flex-col gap-2 rounded-md bg-sunken p-2">
                <Sub>{t("Background")}</Sub>
                <Swatches label={t("Background")} value={str(look.bg)} onChange={(c) => setLook(i, { bg: c })} colors={keySwatches} noneLabel={t("Unchanged")} />
                <Sub>{t("Icon")}</Sub>
                <div className="flex gap-2">
                  <Button size="sm" icon={Search} onClick={() => setPickFor(i)}>
                    {str(look.lucide) ?? t("Choose")}
                  </Button>
                  {!!look.lucide && (
                    <Button size="sm" variant="ghost" onClick={() => setLook(i, { lucide: null })}>
                      {t("Remove")}
                    </Button>
                  )}
                </div>
                <Sub>{t("Text")}</Sub>
                <TextInput value={str(look.text) ?? ""} placeholder={t("Unchanged")} onChange={(e) => setLook(i, { text: e.target.value || null }, `rule:${page}:${k}:${i}:text`)} aria-label={t("Text")} />
                <Button size="sm" className="self-start" onClick={() => setRuleOpen(null)}>
                  {t("Done")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-md bg-sunken py-1.5 pr-1.5 pl-2">
                <span aria-hidden className="grid size-control-lg flex-none place-items-center rounded-sm text-key-fg inset-ring inset-ring-tint-line" style={{ background: str(look.bg) ?? "#1d2330" }}>
                  {idx && str(look.lucide) && <span className="font-lucide text-(length:--icon-lg) leading-none">{luChar(idx, String(look.lucide))}</span>}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <b className="text-sm">{t("Appearance")}</b>
                  <small className="text-sm text-fg-muted">{summary}</small>
                </span>
                <IconButton icon={Pencil} size="sm" label={t("Edit appearance")} onClick={() => setRuleOpen(`${page}:${k}:${i}`)} />
              </div>
            )}
          </LogicBlock>
        );
      })}
      <Button
        size="sm"
        icon={Plus}
        className="self-start"
        onClick={() => {
          editRules((list) => void list.push(clone({ if: { value: "", op: "eq", to: true }, icon: { bg: "#b4232a" } })));
          setRuleOpen(`${page}:${k}:${rules.length}`);
        }}
      >
        {t("Add rule")}
      </Button>
      <IconPicker open={pickFor !== null} onOpenChange={(o) => !o && setPickFor(null)} onPick={(c) => pickFor !== null && setLook(pickFor, { lucide: c })} />
    </div>
  );
}
