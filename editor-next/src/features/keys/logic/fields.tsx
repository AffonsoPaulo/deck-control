// Os campos dos passos: os que ficam dentro da frase ("Abrir [programa]", "Esperar [1] segundos") e os de "mais
// opções" (um por campo do schema da ação). Mesmos tipos e regras do editor atual (inlText, inlNum, inlSeconds,
// inlEnum, inlMode, inlPage, inlColor, inlState, inlCombo, fieldFor, comboInput).
import { CircleDot, Search } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { TextArea, TextInput } from "@/components/Field";
import { InlineInput, InlineSelect } from "@/components/Inline";
import { IconPicker } from "@/components/IconPicker";
import { Select } from "@/components/Select";
import { Swatches, useKeySwatches } from "@/components/Swatches";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import type { Obj } from "@/core/obj";
import { useObs, useSchema } from "@/core/queries";
import { useConfig } from "@/core/store/config";
import { pageNames, type ActionDef, type ActionField } from "@/features/keys/actions";
import { GlyphCard } from "@/features/keys/inspector/LookTab";
import { comboOf } from "@/features/keys/logic/model";
import { stateOptions } from "@/features/keys/look";

export type Set = (field: string, value: unknown, tag?: boolean) => void;

const empty = (v: unknown) => v === null || v === undefined || v === "";

/** Palavra da frase. */
export const W = ({ children }: { children: ReactNode }) => <span>{children}</span>;

export function InlText({ s, f, placeholder, set, wide, list }: { s: Obj; f: string; placeholder: string; set: Set; wide?: boolean; list?: string[] }) {
  const id = useId();
  return (
    <>
      <InlineInput
        type="text"
        minChars={wide ? 14 : 8}
        maxChars={wide ? 40 : 26}
        value={empty(s[f]) ? "" : String(s[f])}
        placeholder={placeholder}
        aria-label={placeholder}
        {...(list ? { list: id } : {})}
        onChange={(e) => set(f, e.target.value || null, true)}
      />
      {list && (
        <datalist id={id}>
          {list.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      )}
    </>
  );
}

export function InlNum({ s, f, placeholder, set }: { s: Obj; f: string; placeholder: string; set: Set }) {
  return (
    <InlineInput
      type="number"
      className="w-16"
      value={empty(s[f]) ? "" : String(s[f])}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => set(f, e.target.value === "" ? null : Number(e.target.value), true)}
    />
  );
}

/** Guardado em ms, mostrado em segundos. */
export function InlSeconds({ s, set }: { s: Obj; set: Set }) {
  const t = useT();
  return (
    <InlineInput
      type="number"
      step="0.1"
      min="0"
      className="w-16"
      value={typeof s.ms === "number" ? String(s.ms / 1000) : ""}
      placeholder="1"
      aria-label={t("Seconds")}
      onChange={(e) => set("ms", e.target.value === "" ? null : Math.round(Number(e.target.value) * 1000), true)}
    />
  );
}

/** Campo de escolha do schema: opcional = a 1ª opção é o padrão (não grava). */
export function InlEnum({ s, f, set, defs }: { s: Obj; f: string; set: Set; defs: Record<string, ActionDef> }) {
  const fd = defs[String(s.type)]?.fields?.find((x) => x.name === f);
  if (!fd?.options) return <W>?</W>;
  return (
    <InlineSelect
      label={fd.label ?? f}
      options={fd.options}
      value={s[f]}
      onChange={(v) => set(f, !fd.required && JSON.stringify(v) === JSON.stringify(fd.options?.[0]?.[0]) ? null : v)}
    />
  );
}

export function InlMode({ s, set, options }: { s: Obj; set: Set; options: [string, string][] }) {
  const t = useT();
  return <InlineSelect label={t("What to do")} options={options} value={s.mode ?? options[0]?.[0]} onChange={(v) => set("mode", v === options[0]?.[0] ? null : v)} />;
}

export function InlPage({ s, set }: { s: Obj; set: Set }) {
  const t = useT();
  const names = pageNames(useConfig((c) => c.cfg));
  const opts: [string, string][] = [["back", t("previous (go back)")], ["home", t("home page##2")], ...names.map((p): [string, string] => [p, p])];
  const cur = typeof s.page === "string" ? s.page : "back";
  if (!opts.some(([o]) => o === cur)) opts.push([cur, t("{0} (doesn't exist)", [cur])]);
  return <InlineSelect label={t("Page")} options={opts} value={cur} onChange={(v) => set("page", v)} />;
}

export function InlColor({ s, f, set, def }: { s: Obj; f: string; set: Set; def: string }) {
  const t = useT();
  const v = typeof s[f] === "string" && /^#[0-9a-f]{6}$/i.test(s[f]) ? s[f] : def;
  // como no atual: sem cor, a padrão já vai para o config
  useEffect(() => {
    if (!s[f]) set(f, def);
  }, [s, f, def, set]);
  return (
    <input
      type="color"
      aria-label={t("Color")}
      value={v}
      onChange={(e) => set(f, e.target.value, true)}
      className="h-7 w-7.5 cursor-pointer rounded-sm border border-tint-line bg-field p-0.5"
    />
  );
}

export function InlState({ s, set }: { s: Obj; set: Set }) {
  const t = useT();
  const schema = useSchema().data;
  const cfg = useConfig((c) => c.cfg);
  const obs = useObs();
  const opts = stateOptions(t, schema, cfg, obs).map(([v, l]): [string, string] => [v, l.charAt(0).toLowerCase() + l.slice(1)]);
  const cur = typeof s.state === "string" ? s.state : null;
  if (cur && !opts.some(([v]) => v === cur)) opts.push([cur, cur]);
  useEffect(() => {
    if (!cur && opts[0]) set("state", opts[0][0]);
  }, [cur, opts, set]);
  return <InlineSelect label={t("Condition")} options={opts} value={cur ?? opts[0]?.[0] ?? ""} onChange={(v) => set("state", v)} />;
}

/** Gravar um atalho: clica e aperta as teclas (Esc desiste). */
function useCapture(onCombo: (c: string) => void) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setOn(false);
      const c = comboOf(e);
      if (!c) return;
      onCombo(c);
      setOn(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [on, onCombo]);
  return { on, start: () => setOn(true) };
}

export function InlCombo({ s, set }: { s: Obj; set: Set }) {
  const t = useT();
  const val = Array.isArray(s.keys) ? s.keys.join(", ") : empty(s.keys) ? "" : String(s.keys);
  const emit = (text: string) => {
    const parts = text.split(",").map((x) => x.trim()).filter(Boolean);
    set("keys", parts.length === 0 ? null : parts.length === 1 ? parts[0] : parts, true);
  };
  const cap = useCapture(emit);
  return (
    <span className="inline-flex items-center gap-0.5">
      <InlineInput type="text" minChars={12} maxChars={34} value={val} placeholder="ctrl+shift+m" aria-label={t("Shortcut##2")} title={t("Several in sequence: separate with commas")} onChange={(e) => emit(e.target.value)} />
      <button
        type="button"
        title={t("Capture: click and press the shortcut")}
        aria-label={t("Capture shortcut")}
        aria-pressed={cap.on}
        onClick={cap.start}
        className={cn(BLK_BTN, cap.on && "bg-danger-solid text-on-danger hover:bg-danger-solid")}
      >
        <CircleDot className="size-icon-xs" strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  );
}

/** Botão pequeno das ferramentas do passo (o .blk-btn do atual). */
export const BLK_BTN = "grid size-control-sm flex-none cursor-pointer place-items-center rounded-sm text-inherit hover:bg-tint-hover focus-visible:outline-2 focus-visible:outline-accent";

// ---------------------------------------------------------------------------- "mais opções"

function FieldBox({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </div>
  );
}

export function ComboInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const t = useT();
  const [text, setText] = useState(Array.isArray(value) ? value.join("\n") : empty(value) ? "" : String(value));
  const emit = (v: string) => {
    setText(v);
    const lines = v.split("\n").map((x) => x.trim()).filter(Boolean);
    onChange(lines.length === 0 ? null : lines.length === 1 ? lines[0] : lines);
  };
  const cap = useCapture(emit);
  return (
    <div className="flex items-center gap-2">
      <TextArea rows={1} placeholder="ctrl+shift+m" value={text} onChange={(e) => emit(e.target.value)} className="min-w-0 flex-1" />
      <Button size="sm" icon={CircleDot} title={t("Click and press the shortcut on the keyboard")} onClick={cap.start}>
        {cap.on ? t("Press the keys…") : t("Capture")}
      </Button>
    </div>
  );
}

export function FieldFor({ f, s, set }: { f: ActionField & Obj; s: Obj; set: Set }) {
  const t = useT();
  const keySwatches = useKeySwatches();
  const obs = useObs();
  const names = pageNames(useConfig((c) => c.cfg));
  const [picker, setPicker] = useState(false);
  const label = String(f.label ?? f.name);
  const help = typeof f.help === "string" ? f.help : undefined;
  const v = s[f.name];
  const put = (x: unknown, tag = false) => set(f.name, x, tag);
  const text = (placeholder?: string, list?: string[]) => (
    <TextBox value={v} placeholder={placeholder ?? (typeof f.placeholder === "string" ? f.placeholder : "")} list={list} onChange={(x) => put(x, true)} />
  );
  const box = (control: ReactNode) => (
    <FieldBox label={label} {...(help ? { hint: help } : {})}>
      {control}
    </FieldBox>
  );
  switch (f.kind) {
    case "textarea":
      return box(<TextArea rows={2} value={empty(v) ? "" : String(v)} onChange={(e) => put(e.target.value || null, true)} />);
    case "number":
      return box(
        <TextInput
          type="number"
          step={typeof f.step === "string" || typeof f.step === "number" ? String(f.step) : "any"}
          value={empty(v) ? "" : String(v)}
          placeholder={typeof f.placeholder === "string" ? f.placeholder : ""}
          onChange={(e) => put(e.target.value === "" ? null : Number(e.target.value), true)}
        />,
      );
    case "bool": {
      const on = v === undefined ? !!f.default : !!v;
      return (
        <div className="grid gap-1.5">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={on} onChange={(e) => put(e.target.checked === !!f.default ? null : e.target.checked)} className="accent-accent" />
            {label}
          </label>
          {help && <span className="text-xs text-fg-subtle">{help}</span>}
        </div>
      );
    }
    case "enum": {
      const opts = f.options ?? [];
      const idx = opts.findIndex(([o]) => JSON.stringify(o) === JSON.stringify(v));
      return box(
        <Select
          aria-label={label}
          value={String(idx >= 0 ? idx : 0)}
          onChange={(i) => put(!f.required && i === "0" ? null : opts[Number(i)]?.[0])}
          options={opts.map(([, l], i) => ({ value: String(i), label: l }))}
        />,
      );
    }
    case "combo":
      return box(<ComboInput value={v} onChange={(x) => put(x, true)} />);
    case "json":
      return box(<JsonInput value={v} onChange={(x) => put(x, true)} />);
    case "color":
      return box(
        <Swatches
          label={label}
          value={typeof v === "string" ? v : null}
          onChange={put}
          colors={[...keySwatches, { value: "#22c55e", label: t("Green") }, { value: "#ef4444", label: t("Red") }]}
          {...(!f.default ? { noneLabel: t("None") } : {})}
        />,
      );
    case "icon":
      return box(
        <>
          {typeof v === "string" && v ? (
            <GlyphCard icon={{ lucide: v }} onChoose={() => setPicker(true)} onRemove={() => put(null)} />
          ) : (
            <Button size="sm" icon={Search} className="justify-self-start" onClick={() => setPicker(true)}>
              {t("Choose icon")}
            </Button>
          )}
          <IconPicker open={picker} onOpenChange={setPicker} onPick={put} />
        </>,
      );
    case "page": {
      const opts = [{ value: "back", label: t("Back (previous page)") }, { value: "home", label: t("Home page") }, ...names.map((p) => ({ value: p, label: p }))];
      const cur = typeof v === "string" && v ? v : "back";
      if (!opts.some((o) => o.value === cur)) opts.push({ value: cur, label: t("{0} (doesn't exist)", [cur]) });
      return box(<Select aria-label={label} value={cur} onChange={put} options={opts} />);
    }
    case "scene":
      return box(text(obs.scenes.length ? t("choose or type") : t("scene name"), obs.scenes));
    case "input":
      return box(text(obs.inputs.length ? t("choose or type") : t("audio source name"), obs.inputs));
    case "source":
      return box(text(t("source name"), obs.sources[String(s.scene)] ?? []));
    default:
      return box(text());
  }
}

function TextBox({ value, placeholder, list, onChange }: { value: unknown; placeholder: string; list?: string[] | undefined; onChange: (v: string | null) => void }) {
  const id = useId();
  return (
    <>
      <TextInput value={empty(value) ? "" : String(value)} placeholder={placeholder} {...(list ? { list: id } : {})} onChange={(e) => onChange(e.target.value || null)} />
      {list && (
        <datalist id={id}>
          {list.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      )}
    </>
  );
}

export function JsonInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value === null || value === undefined ? "" : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <TextArea
      placeholder="{ }"
      value={text}
      aria-invalid={bad}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (!v.trim()) {
          setBad(false);
          return onChange(null);
        }
        try {
          onChange(JSON.parse(v));
          setBad(false);
        } catch {
          setBad(true);
        }
      }}
      className={cn("min-h-22.5 font-mono text-sm", bad && "border-danger-fg")}
    />
  );
}
