// Tela "Automações" (o renderAutomationsView do editor atual): coisas que o Deck faz sozinho, sem apertar tecla.
// À esquerda a lista (ligar/desligar cada uma), à direita a escolhida: nome, quando (horário, de tempos em tempos,
// contagem, valor mudou, Deck conectou, entrou numa página), o que fazer (a mesma lista de passos das teclas) e
// as opções (não repetir antes de X s, só em certos dias).
import { Clock, Hourglass, Info, Layers, Plus, Power, Repeat, Trash2, Braces, Zap, type LucideIcon } from "lucide-react";
import { create } from "zustand";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { InlineSelect } from "@/components/Inline";
import { Segmented } from "@/components/Segmented";
import { catStyle } from "@/components/Library";
import { NoteBox } from "@/components/NoteBox";
import { useKeySwatches } from "@/components/Swatches";
import { Switch } from "@/components/Switch";
import { useT } from "@/core/i18n";
import { isObj, type Obj } from "@/core/obj";
import { useObs, useSchema } from "@/core/queries";
import { useConfig, type Config } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { actionDefs, collapse, toList } from "@/features/keys/actions";
import { CondEditor } from "@/features/keys/CondEditor";
import { DeckDnd } from "@/features/keys/dnd";
import { logicDrop } from "@/features/keys/drop";
import { Ghost } from "@/features/keys/Ghost";
import { stateOptions } from "@/features/keys/look";
import { Flow, useSteps, type Logic } from "@/features/keys/logic/DoTab";
import type { Model } from "@/features/keys/logic/model";
import { pagesOf, type DragPayload, type KeySpec } from "@/features/keys/model";
import { summarize, type SummaryCtx } from "@/features/keys/summary";
import { useValueDefs, valueLabel } from "@/features/keys/values";

type T = ReturnType<typeof useT>;

/** Qual automação está aberta (fica ao trocar de tela, como no atual). */
const useAutoSel = create<{ sel: number }>()(() => ({ sel: 0 }));

const autosOf = (cfg: Config | null): Obj[] => (cfg && Array.isArray(cfg.automations) ? (cfg.automations as Obj[]) : []);

function triggers(t: T): [string, LucideIcon, string, string][] {
  return [
    ["time", Clock, t("Time of day"), t("every day, at a time")],
    ["every", Repeat, t("Every"), t("from time to time")],
    ["countdown", Hourglass, t("Countdown"), t("once, in X min")],
    ["value", Braces, t("Value changed"), t("when something starts to hold")],
    ["connected", Power, t("Deck connected"), t("when the device connects")],
    ["page", Layers, t("Entering a page"), t("when a page opens")],
  ];
}

function useAutoSummary() {
  const t = useT();
  const values = useValueDefs();
  const ops: Record<string, string> = { eq: t("is"), ne: t("is not"), gt: t("is greater than"), lt: t("is less than"), ge: t("is at least"), le: t("is at most"), contains: t("contains") };
  return (a: Obj) => {
    const w = isObj(a.when) ? a.when : {};
    switch (w.type) {
      case "time":
        return t("Every day at {0}", [w.at || "?"]);
      case "every":
        return t("Every {0} min", [w.minutes || "?"]);
      case "countdown":
        return t("In {0} min (once)", [w.minutes || "?"]);
      case "value":
        return w.value
          ? t("When {0} {1} {2}", [valueLabel(values, String(w.value)), ops[String(w.op || "eq")] ?? "=", w.to === true ? t("yes") : w.to === false ? t("no") : (w.to ?? "")])
          : t("When a value changes");
      case "connected":
        return t("When the Deck connects");
      case "page":
        return t("When entering the page {0}", [w.page || "?"]);
      default:
        return t("New automation");
    }
  };
}

/** A lista de passos de uma automação: o "do" dela como a lista "ao apertar" de uma tecla. */
function useAutoLogic(index: number): Logic {
  const schema = useSchema().data;
  const edit = useConfig((s) => s.edit);
  const withAuto = (d: Config, fn: (a: Obj) => void) => {
    const a = autosOf(d)[index];
    if (isObj(a)) fn(a);
  };
  return {
    defs: actionDefs(schema),
    schema,
    change: (fn, tag) =>
      edit(
        (d) =>
          withAuto(d, (a) => {
            const m: Model = { action: toList(a.do), double: [], hold: [], release: [] };
            fn(m, a as KeySpec);
            const v = collapse(m.action);
            if (v) a.do = v;
            else Reflect.deleteProperty(a, "do");
          }),
        tag,
      ),
    setSpec: (fn, tag) => edit((d) => withAuto(d, (a) => fn(a as KeySpec)), tag),
  };
}

export function AutoSection() {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  const edit = useConfig((s) => s.edit);
  const page = useUi((s) => s.page) ?? "main";
  const list = autosOf(cfg);
  const raw = useAutoSel((s) => s.sel);
  const sel = raw >= list.length ? (list.length ? 0 : -1) : raw;
  const summary = useAutoSummary();
  const schema = useSchema().data;
  const obs = useObs();
  const swatches = useKeySwatches();
  const sctx: SummaryCtx = { defs: actionDefs(schema), values: useValueDefs(), states: stateOptions(t, schema, cfg, obs), swatches };
  const trig = triggers(t);
  const select = (i: number) => useAutoSel.setState({ sel: i });

  const add = () => {
    edit((d) => {
      if (!Array.isArray(d.automations)) d.automations = [];
      (d.automations as Obj[]).push({ name: "", enabled: true, when: { type: "value", value: "", op: "eq", to: true }, do: [] });
    });
    select(list.length);
  };

  return (
    <DeckDnd
      pitch={{ x: 0, y: 48 }}
      onMove={() => {}}
      onDrop={(p) => {
        if (p.target?.startsWith("slot|")) void logicDrop.current?.(p.payload, p.target);
      }}
      ghost={(p: DragPayload) => <Ghost payload={p} page={page} previews={undefined} />}
      ghostSize={() => ({ width: 260, height: 40 })}
      canDrag={(p) => p.kind === "step"}
      nameOf={(p) => ("label" in p ? p.label : "")}
    >
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full flex-wrap">
          <aside className="box-border flex w-100 max-w-full min-w-0 flex-none flex-col gap-2.5 border-r border-border bg-field px-4.5 py-5.5">
            <div className="flex items-center gap-2.5">
              <p className="m-0 flex-1 text-xs leading-4.25 text-fg-subtle">{t("Things the Deck does on its own, without pressing a key.")}</p>
              <Button variant="primary" icon={Plus} onClick={add}>
                {t("New")}
              </Button>
            </div>
            {list.map((a, i) => {
              const w = isObj(a.when) ? a.when : {};
              const tr = trig.find((x) => x[0] === w.type) ?? trig[0];
              const steps = toList(a.do);
              const name = typeof a.name === "string" && a.name ? a.name : summary(a);
              return (
                <div
                  key={i}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface pr-3.5 transition-colors duration-(--duration-fast) data-selected:bg-sunken data-selected:inset-ring data-selected:inset-ring-accent"
                  data-selected={i === sel ? "" : undefined}
                >
                  <button
                    type="button"
                    aria-current={i === sel}
                    onClick={() => select(i)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pl-3.5 text-left text-fg focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span aria-hidden style={catStyle("var(--cat-violet)")} className="grid size-control-lg flex-none place-items-center rounded-md bg-cat-chip text-cat-ink">
                      {tr && <Icon icon={tr[1]} />}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <b className="text-base">{name}</b>
                      <small className="truncate text-sm text-fg-muted">{steps.length ? steps.map((s) => summarize(t, sctx, s)).join(", ") : t("Nothing to do yet")}</small>
                    </span>
                  </button>
                  <Switch
                    hideLabel
                    label={t("Turn on {0}", [name])}
                    checked={a.enabled !== false}
                    onChange={(on) =>
                      edit((d) => {
                        const x = autosOf(d)[i];
                        if (!x) return;
                        if (on) Reflect.deleteProperty(x, "enabled");
                        else x.enabled = false;
                      })
                    }
                  />
                </div>
              );
            })}
            {!list.length && (
              <NoteBox icon={Zap} tone="info">
                {t("No automations yet. Create one: for example, “when the live starts, light the ring green for 3 seconds”.")}
              </NoteBox>
            )}
          </aside>
          <section className="flex min-w-0 shrink grow-999 basis-140 flex-col gap-6 px-7.5 py-6.5">
            {sel >= 0 && list[sel] ? (
              <AutoEditor key={sel} index={sel} auto={list[sel]} page={page} summary={summary(list[sel])} onDeleted={() => select(Math.max(0, sel - 1))} />
            ) : (
              <p className="m-0 text-xs leading-4.25 text-fg-subtle">{t("Choose or create an automation on the left.")}</p>
            )}
          </section>
        </div>
      </main>
    </DeckDnd>
  );
}

function AutoEditor({ index, auto, page, summary, onDeleted }: { index: number; auto: Obj; page: string; summary: string; onDeleted: () => void }) {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  const edit = useConfig((s) => s.edit);
  const logic = useAutoLogic(index);
  const { ctx, picker } = useSteps(page, logic);
  const w = isObj(auto.when) ? auto.when : { type: "value" };
  const steps = toList(auto.do);
  const tag = (k: string) => `auto:${index}:${k}`;
  const set = (fn: (a: Obj) => void, k?: string) =>
    edit(
      (d) => {
        const a = autosOf(d)[index];
        if (isObj(a)) fn(a);
      },
      k ? tag(k) : undefined,
    );
  const setWhen = (patch: Obj, k?: string) =>
    set((a) => {
      a.when = { ...(isObj(a.when) ? a.when : { type: "value" }), ...patch };
    }, k);
  const pages = Object.keys(pagesOf(cfg));
  const LBL = "text-base font-semibold text-fg-label";

  return (
    <>
      <div className="flex items-center gap-3">
        <TextInput
          value={typeof auto.name === "string" ? auto.name : ""}
          placeholder={summary}
          aria-label={t("Automation name")}
          onChange={(e) => {
            const v = e.target.value;
            set((a) => {
              if (v) a.name = v;
              else Reflect.deleteProperty(a, "name");
            }, "name");
          }}
          className="h-control-xl max-w-105 text-md font-semibold"
        />
        <span className="flex-1" />
        <IconButton
          icon={Trash2}
          label={t("Delete automation")}
          title={t("Delete automation")}
          onClick={() => {
            edit((d) => {
              const l = autosOf(d);
              l.splice(index, 1);
              if (!l.length) Reflect.deleteProperty(d, "automations");
            });
            onDeleted();
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className={LBL}>{t("When")}</span>
        <div className="grid max-w-160 grid-cols-3 gap-1.5">
          {triggers(t).map(([type, icon, label, desc]) => (
            <button
              key={type}
              type="button"
              aria-pressed={w.type === type}
              onClick={() =>
                set((a) => {
                  a.when = {
                    type,
                    ...(type === "time"
                      ? { at: "18:00" }
                      : type === "every"
                        ? { minutes: 60 }
                        : type === "countdown"
                          ? { minutes: 25 }
                          : type === "page"
                            ? { page }
                            : type === "value"
                              ? { value: "", op: "eq", to: true }
                              : {}),
                  };
                })
              }
              className="flex min-h-15.5 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-1 py-2 text-center text-xs font-semibold text-fg-muted transition-colors duration-(--duration-fast) hover:bg-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:text-fg aria-pressed:inset-ring aria-pressed:inset-ring-accent"
            >
              <Icon icon={icon} size="lg" />
              <span>{label}</span>
              <small className="text-2xs font-medium text-fg-subtle">{desc}</small>
            </button>
          ))}
        </div>
        <TriggerFields w={w} pages={pages} setWhen={setWhen} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center">
          <span className={`${LBL} flex-1`}>{t("Do")}</span>
          <Button size="sm" icon={Plus} onClick={() => ctx.pick(["action"], steps.length)}>
            {t("Step")}
          </Button>
        </div>
        <div className="max-w-160">
          <Flow ctx={ctx} path={["action"]} list={steps} top />
        </div>
        <p className="m-0 text-xs leading-4.25 text-fg-subtle">{t("Any key action works here: pages, shortcuts, OBS, sequences and the temporary responses.")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <span className={LBL}>{t("Options")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span>{t("Don't run again before")}</span>
          <NumberBox
            value={auto.cooldown}
            placeholder="0"
            label={t("Don't run again before")}
            onChange={(v) =>
              set((a) => {
                if (v === null) Reflect.deleteProperty(a, "cooldown");
                else a.cooldown = v;
              }, "cooldown")
            }
          />
          <span>{t("seconds")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>{t("Only on")}</span>
          <Segmented
            variant="pills"
            label={t("Days")}
            value={typeof auto.days === "string" ? auto.days : "all"}
            onChange={(v) =>
              set((a) => {
                if (v === "all") Reflect.deleteProperty(a, "days");
                else a.days = v;
              })
            }
            options={[
              { value: "all", label: t("Every day") },
              { value: "weekdays", label: t("Mon to Fri") },
              { value: "weekend", label: t("Weekend") },
            ]}
          />
        </div>
      </div>
      <NoteBox icon={Info} tone="info">
        {t("Automations run while the app is open (the icon in the tray).")}
      </NoteBox>
      {picker}
    </>
  );
}

function NumberBox({ value, onChange, placeholder, label }: { value: unknown; onChange: (v: number | null) => void; placeholder: string; label: string }) {
  return (
    <TextInput
      type="number"
      step="any"
      value={value === undefined || value === null ? "" : String(value)}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="w-22.5 flex-none"
    />
  );
}

function TriggerFields({ w, pages, setWhen }: { w: Obj; pages: string[]; setWhen: (patch: Obj, tag?: string) => void }) {
  const t = useT();
  const ROW = "mt-1 flex flex-wrap items-center gap-2 text-base";
  switch (w.type) {
    case "time":
      return (
        <div className={ROW}>
          <span>{t("At")}</span>
          <TextInput type="time" value={typeof w.at === "string" ? w.at : "18:00"} aria-label={t("Time")} onChange={(e) => setWhen({ at: e.target.value }, "at")} className="w-30" />
        </div>
      );
    case "every":
    case "countdown":
      return (
        <div className={ROW}>
          <span>{w.type === "every" ? t("Every") : t("In")}</span>
          <NumberBox value={w.minutes ?? 60} placeholder="60" label={t("minutes")} onChange={(v) => setWhen({ minutes: v }, "minutes")} />
          <span>{t("minutes")}</span>
        </div>
      );
    case "value":
      return (
        <div className={ROW}>
          <CondEditor cond={w} onChange={(c) => setWhen(c)} />
          <p className="m-0 basis-full text-xs leading-4.25 text-fg-subtle">{t("Runs once each time the condition starts to hold.")}</p>
        </div>
      );
    case "page":
      return (
        <div className={ROW}>
          <span>{t("Page")}</span>
          <InlineSelect label={t("Page")} value={w.page} options={pages.map((p) => [p, p] as [string, string])} onChange={(v) => setWhen({ page: v })} />
        </div>
      );
    default:
      return <span />;
  }
}
