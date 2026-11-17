// A condição "valor / comparação / com o quê" ({value, op, to}), dentro de uma frase. Valor sim/não vira
// "é [sim|não]"; os outros, "[é / não é / é maior que...] [texto ou número]". Mesmas regras do condEditor do
// editor atual (trocar o valor ajusta a comparação; número digitado vira número).
import { InlineInput, InlineSelect } from "@/components/Inline";
import { useT } from "@/core/i18n";
import type { Obj } from "@/core/obj";
import { ValueSelect } from "@/features/keys/ValueSelect";
import { useLiveValues, useValueDefs, valueNow } from "@/features/keys/values";

/** Condição antiga ({state, is}) vira valor ao mexer: lê já no formato novo. */
export function readCond(c: Obj): Obj {
  if (!c.value && c.state) return { value: c.state, op: "eq", to: c.is === false ? false : true };
  return c;
}

export function CondEditor({ cond, onChange }: { cond: Obj; onChange: (c: Obj) => void }) {
  const t = useT();
  const defs = useValueDefs();
  const live = useLiveValues();
  const c = readCond(cond);
  const value = typeof c.value === "string" ? c.value : "";
  const def = defs.find((d) => d.id === value);
  const emit = (patch: Obj) => {
    const next: Obj = { ...c, ...patch };
    Reflect.deleteProperty(next, "state");
    Reflect.deleteProperty(next, "is");
    onChange(next);
  };
  const ops: [string, string][] = [
    ["eq", t("is")],
    ["ne", t("is not")],
    ["gt", t("is greater than")],
    ["lt", t("is less than")],
    ["ge", t("is at least")],
    ["le", t("is at most")],
    ["contains", t("contains")],
  ];
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <ValueSelect
        value={value || null}
        size="inline"
        label={t("Value")}
        {...(value ? {} : { empty: t("choose a value…") })}
        onPick={(v) => {
          const nd = defs.find((d) => d.id === v);
          if (nd?.kind === "bool") emit({ value: v, op: "eq", to: true });
          else emit({ value: v, op: c.op && c.op !== "eq" ? c.op : "eq", to: typeof c.to === "boolean" ? "" : c.to });
        }}
        className="min-w-0 flex-1"
      />
      {value && def?.kind === "bool" ? (
        <>
          <span>{t("is")}</span>
          <InlineSelect
            label={t("Yes or no")}
            options={[
              [true, t("yes")],
              [false, t("no")],
            ]}
            value={c.to !== false}
            onChange={(v) => emit({ op: "eq", to: v })}
          />
        </>
      ) : value ? (
        <>
          <InlineSelect label={t("Comparison")} options={ops} value={typeof c.op === "string" ? c.op : "eq"} onChange={(v) => emit({ op: v })} />
          <InlineInput
            type="text"
            minChars={4}
            maxChars={16}
            aria-label={t("Compare with")}
            value={c.to === undefined || c.to === null ? "" : String(c.to)}
            placeholder={valueNow(defs, live, value)}
            onChange={(e) => {
              const s = e.target.value;
              const n = Number(s.replace(",", "."));
              emit({ to: s !== "" && !isNaN(n) ? n : s });
            }}
          />
        </>
      ) : null}
    </span>
  );
}
