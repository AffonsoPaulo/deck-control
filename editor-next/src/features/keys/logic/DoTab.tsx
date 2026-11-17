// Aba "O que faz": os quatro momentos da tecla (apertar, toque duplo, segurar, soltar), cada um com a sua lista
// de passos. Cada passo é uma frase com os campos dentro ("Abrir [programa]"); "Se", "liga/desliga" e
// "sequência" são blocos com listas dentro. Arrastar pela alça muda a ordem (ou leva para outra lista); uma
// ação da biblioteca solta numa lista vira passo. Mesmas regras do editor atual (doTab, renderFlow, block,
// cBlock, sentence, repeatRow).
import { CornerDownRight, Ellipsis, GripVertical, ListOrdered, Plus, Split, ToggleRight, Trash2, TriangleAlert, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/react";
import { useEffect, useState, type ReactNode } from "react";
import { IconButton } from "@/components/IconButton";
import { NamedIcon } from "@/components/NamedIcon";
import { BindField, useClash } from "@/features/keys/logic/BindField";
import { InlineInput, InlineSelect } from "@/components/Inline";
import { catStyle } from "@/components/Library";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import type { Obj } from "@/core/obj";
import { useObs, useSchema } from "@/core/queries";
import { useConfig } from "@/core/store/config";
import { toast } from "@/core/toast";
import { MOMENTS, actionDefs, groupOf, groupsOf, iconOf, newStep, pageNames, type ActionDef } from "@/features/keys/actions";
import { ActionPicker } from "@/features/keys/ActionPicker";
import { CondEditor, readCond } from "@/features/keys/CondEditor";
import { logicDrop } from "@/features/keys/drop";
import { draftKeys } from "@/features/keys/keys";
import { ChipLabel } from "@/features/keys/LogicBlock";
import {
  BLK_BTN,
  FieldFor,
  InlColor,
  InlCombo,
  InlEnum,
  InlMode,
  InlNum,
  InlPage,
  InlSeconds,
  InlState,
  InlText,
  W,
  type Set,
} from "@/features/keys/logic/fields";
import { SENTENCE_FIELDS, commitModel, containsList, listAt, modelOf, repeatable, type ListField, type ListPath, type Model, type Moment } from "@/features/keys/logic/model";
import type { DragPayload, KeySpec } from "@/features/keys/model";
import { fillBinds } from "@/features/keys/place";

type T = ReturnType<typeof useT>;

/** Mexer nas listas da tecla: monta o modelo, muda e grava de volta (com as regras do commitModel). */
function useLogic(page: string, k: string) {
  const t = useT();
  const schema = useSchema().data;
  const edit = useConfig((s) => s.edit);
  const defs = actionDefs(schema);
  const change = (fn: (m: Model, spec: KeySpec) => void, tag?: string) =>
    edit((d) => {
      const spec = draftKeys(d, page)[k];
      if (!spec) return;
      const m = modelOf(spec);
      fn(m, spec);
      commitModel(spec, m, defs, t);
    }, tag);
  const setSpec = (fn: (spec: KeySpec) => void, tag?: string) =>
    edit((d) => {
      const spec = draftKeys(d, page)[k];
      if (spec) fn(spec);
    }, tag);
  return { change, setSpec, defs, schema };
}

type Logic = ReturnType<typeof useLogic>;

interface Ctx {
  page: string;
  k: string;
  logic: Logic;
  pick: (path: ListPath, index: number) => void;
  wide: boolean; // na visão ampliada: a frase um pouco maior
}

export function DoTab({ page, k, spec, wide }: { page: string; k: string; spec: KeySpec; wide?: boolean }) {
  const t = useT();
  const logic = useLogic(page, k);
  const doubleMs = useConfig((s) => Number(s.cfg?.double_tap_ms) || 250);
  const [picking, setPicking] = useState<{ path: ListPath; index: number } | null>(null);
  const model = modelOf(spec);
  const insert = async (path: ListPath, index: number, type: string) => {
    const cfg = useConfig.getState().cfg;
    const step = newStep(logic.defs, type, { pages: pageNames(cfg), page, scenes: obsScenes() });
    await fillBinds([step], t, logic.schema);
    logic.change((m) => void listAt(m, path).splice(index, 0, step));
  };
  const obs = useObs();
  const obsScenes = () => obs.scenes;
  const ctx: Ctx = { page, k, logic, pick: (path, index) => setPicking({ path, index }), wide: !!wide };

  // o que cai numa lista de passos (ação da biblioteca ou passo arrastado)
  useEffect(() => {
    logicDrop.current = async (payload: DragPayload, target: string) => {
      const [, raw, idx] = target.split("|");
      const path = JSON.parse(raw ?? "[]") as ListPath;
      let index = Number(idx);
      if (payload.kind === "new") return insert(path, index, payload.type);
      if (payload.kind !== "step") return;
      const from = payload.path as ListPath;
      logic.change((m) => {
        const src = listAt(m, from);
        const step = src[payload.index];
        const dst = listAt(m, path);
        if (step === undefined) return;
        if (containsList(step, dst)) {
          toast(t("A block can't go inside itself."), { bad: true });
          return;
        }
        src.splice(payload.index, 1);
        if (src === dst && payload.index < index) index--;
        dst.splice(index, 0, step);
      });
    };
    return () => {
      logicDrop.current = null;
    };
  });

  const NAMES: Record<Moment, string> = { action: t("On press"), double: t("On double tap"), hold: t("On hold"), release: t("On release") };
  const pressRepeats = spec.repeat === "press";
  return (
    <div className={cn("grid gap-6 p-4", wide && "mx-auto max-w-180 gap-7 p-0")}>
      {MOMENTS.map((id) => {
        const list = model[id];
        const unused = pressRepeats && (id === "double" || id === "hold");
        return (
          <section key={id} className="grid gap-2">
            <div className="flex min-h-8 items-center gap-2">
              <span className={cn("text-base font-bold", list.length ? "text-fg" : "text-fg-subtle")}>{NAMES[id]}</span>
              {id === "action" && model.double.length > 0 && <span className="text-sm text-fg-subtle">{t("single tap")}</span>}
              {id === "action" && !model.double.length && model.hold.length > 0 && <span className="text-sm text-fg-subtle">{t("quick tap")}</span>}
              {id === "hold" && list.length > 0 && (
                <>
                  <span className="text-sm text-fg-subtle">{t("for")}</span>
                  <MsInput spec={spec} field="hold_ms" placeholder="500" logic={logic} />
                  <span className="text-sm text-fg-subtle">ms</span>
                </>
              )}
              <span className="flex-1" />
              <IconButton icon={Plus} size="sm" label={t('Add step to "{0}"', [NAMES[id].toLowerCase()])} title={t("Add step")} onClick={() => ctx.pick([id], list.length)} />
              <IconButton
                icon={Trash2}
                size="sm"
                label={t('Remove "{0}"', [NAMES[id].toLowerCase()])}
                title={list.length ? t("Remove everything in this moment") : t("Nothing to remove")}
                disabled={!list.length}
                onClick={() =>
                  logic.change((m, s) => {
                    m[id] = [];
                    if (id === "hold") delete s.hold_ms;
                  })
                }
              />
            </div>
            {id === "action" && repeatable(logic.defs, list) && <RepeatRow spec={spec} which="press" logic={logic} />}
            {id === "hold" && !pressRepeats && repeatable(logic.defs, list) && <RepeatRow spec={spec} which="hold" logic={logic} />}
            {unused && list.length > 0 ? (
              <p className="m-0 text-sm leading-(--text-base--line-height) text-fg-subtle">{t("Not used: with “Repeat while held” on in On press, holding the key repeats it.")}</p>
            ) : id === "double" && list.length > 0 ? (
              <p className="m-0 text-sm leading-(--text-base--line-height) text-fg-subtle">
                {t("To tell one tap from two, the keys of this page wait {0} ms before running “On press”. The light reacts right away.", [doubleMs])}
              </p>
            ) : null}
            <div className={cn(unused && "opacity-45")}>
              <Flow ctx={ctx} path={[id]} list={list} top />
            </div>
          </section>
        );
      })}
      <ActionPicker open={picking !== null} onOpenChange={(o) => !o && setPicking(null)} onPick={(type) => picking && void insert(picking.path, picking.index, type)} />
    </div>
  );
}

function MsInput({ spec, field, placeholder, logic }: { spec: KeySpec; field: string; placeholder: string; logic: Logic }) {
  const t = useT();
  return (
    <InlineInput
      type="number"
      className="w-16"
      value={spec[field] === undefined ? "" : String(spec[field])}
      placeholder={placeholder}
      aria-label={t("Milliseconds")}
      onChange={(e) =>
        logic.setSpec((s) => {
          if (e.target.value === "") Reflect.deleteProperty(s, field);
          else s[field] = Number(e.target.value);
        }, `ms:${field}`)
      }
    />
  );
}

function RepeatRow({ spec, which, logic }: { spec: KeySpec; which: "press" | "hold"; logic: Logic }) {
  const t = useT();
  const on = spec.repeat === which;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <label className="mr-1 flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={on}
          className="accent-accent"
          onChange={(e) =>
            logic.setSpec((s) => {
              if (e.target.checked) s.repeat = which;
              else for (const f of ["repeat", "repeat_ms", "repeat_delay"]) Reflect.deleteProperty(s, f);
            })
          }
        />
        {t("Repeat while held")}
      </label>
      {on && which === "press" && (
        <>
          <span className="text-sm text-fg-subtle">{t("starts after")}</span>
          <MsInput spec={spec} field="repeat_delay" placeholder="400" logic={logic} />
          <span className="text-sm text-fg-subtle">ms,</span>
        </>
      )}
      {on && (
        <>
          <span className="text-sm text-fg-subtle">{t("every")}</span>
          <MsInput spec={spec} field="repeat_ms" placeholder="80" logic={logic} />
          <span className="text-sm text-fg-subtle">ms</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- a lista

const slotId = (path: ListPath, index: number) => `slot|${JSON.stringify(path)}|${index}`;

function Slot({ path, index }: { path: ListPath; index: number }) {
  const { ref, isDropTarget } = useDroppable({ id: slotId(path, index) });
  return (
    <div ref={ref} className="relative h-2">
      {isDropTarget && <span className="absolute inset-x-1 top-0.5 h-1 rounded-xs bg-accent" />}
    </div>
  );
}

function Flow({ ctx, path, list, top }: { ctx: Ctx; path: ListPath; list: Obj[]; top?: boolean }) {
  const t = useT();
  const { ref, isDropTarget } = useDroppable({ id: slotId(path, 0) + (list.length ? "|unused" : "") });
  if (!list.length) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={() => ctx.pick(path, 0)}
        className={cn(
          "flex w-full cursor-pointer items-center rounded-md px-3 text-left text-sm text-fg-subtle hover:bg-raised hover:text-fg-muted focus-visible:outline-2 focus-visible:outline-accent",
          top ? "h-control-xl bg-sunken" : "h-control-lg bg-transparent",
          isDropTarget && "bg-accent-soft inset-ring-2 inset-ring-accent",
        )}
      >
        {top ? t("No steps. Drag an action here.") : t("Empty. Drag an action here.")}
      </button>
    );
  }
  return (
    <div className="grid">
      {list.map((step, i) => (
        <div key={i}>
          <Slot path={path} index={i} />
          <Step ctx={ctx} path={path} index={i} step={step} />
        </div>
      ))}
      <Slot path={path} index={list.length} />
    </div>
  );
}

/** A alça de arrastar e o "x" de tirar, iguais em todo passo. */
function useStepDrag(path: ListPath, index: number, label: string) {
  const payload: DragPayload = { kind: "step", path: path as (string | number)[], index, label };
  return useDraggable({ id: `step|${JSON.stringify(path)}|${index}`, data: payload });
}

function Tools({ ctx, path, index, handle, extra }: { ctx: Ctx; path: ListPath; index: number; handle: (el: Element | null) => void; extra?: ReactNode }) {
  const t = useT();
  return (
    <span className="ml-auto flex h-7.5 flex-none items-center opacity-0 group-focus-within/step:opacity-100 group-hover/step:opacity-100">
      {extra}
      <span ref={handle} title={t("Drag to reorder")} className="grid h-control-sm w-6 cursor-grab place-items-center" aria-hidden>
        <GripVertical className="size-icon-xs" strokeWidth={1.75} />
      </span>
      <button type="button" title={t("Remove step")} aria-label={t("Remove step")} className={BLK_BTN} onClick={() => ctx.logic.change((m) => void listAt(m, path).splice(index, 1))}>
        <X className="size-icon-md" strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  );
}

function Step({ ctx, path, index, step }: { ctx: Ctx; path: ListPath; index: number; step: Obj }) {
  if (step.type === "if" || step.type === "toggle" || step.type === "multi") return <CBlock ctx={ctx} path={path} index={index} step={step} />;
  return <Block ctx={ctx} path={path} index={index} step={step} />;
}

/** Mudar um campo do passo (null/"" apaga), juntando digitação numa entrada do desfazer. */
function useSetter(ctx: Ctx, path: ListPath, index: number): Set {
  return (field, value, tag) =>
    ctx.logic.change(
      (m) => {
        const s = listAt(m, path)[index];
        if (!s) return;
        if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) Reflect.deleteProperty(s, field);
        else s[field] = value;
      },
      tag ? `step:${JSON.stringify(path)}:${index}:${field}` : undefined,
    );
}

function Block({ ctx, path, index, step }: { ctx: Ctx; path: ListPath; index: number; step: Obj }) {
  const t = useT();
  const set = useSetter(ctx, path, index);
  const { defs, schema } = ctx.logic;
  const type = String(step.type);
  const group = groupOf(groupsOf(schema), defs, type);
  const d = defs[type] as (ActionDef & Obj) | undefined;
  const extras = d && d.fields !== null ? (d.fields ?? []).filter((f) => !(SENTENCE_FIELDS[type] ?? []).includes(f.name) && f.kind !== "action" && f.kind !== "actions") : null;
  const hasValue = !!extras?.some((f) => step[f.name] !== undefined);
  const clash = useClash(step);
  const [openState, setOpen] = useState(hasValue);
  const open = openState || clash;
  const label = d ? t(d.label) : type;
  const more = extras === null || extras.length > 0 || type === "bind";
  const { ref, handleRef, isDragSource } = useStepDrag(path, index, label);
  return (
    <div
      ref={ref}
      style={catStyle(group.color)}
      className={cn("group/step rounded-md text-fg", group.name === "Pages and logic" ? "bg-raised" : "bg-cat-block", isDragSource && "opacity-40")}
    >
      <div className={cn("flex min-h-control-2xl items-start gap-2 py-1.5 pr-1.5 pl-2.5 font-semibold", ctx.wide ? "text-md" : "text-base")}>
        <span aria-hidden className="grid h-7.5 w-4.5 flex-none place-items-center text-cat-ink">
          <NamedIcon name={iconOf(defs, type)} />
        </span>
        <span className="flex min-h-7.5 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
          <Sentence s={step} set={set} defs={defs} t={t} />
        </span>
        {clash && (
          <span role="img" title={t("Repeated shortcut")} aria-label={t("Repeated shortcut")} className="grid h-7.5 flex-none place-items-center text-danger-fg">
            <TriangleAlert className="size-icon-md" strokeWidth={1.75} aria-hidden />
          </span>
        )}
        <Tools
          ctx={ctx}
          path={path}
          index={index}
          handle={handleRef}
          extra={
            more ? (
              <button type="button" title={t("More options")} aria-label={t("More options")} aria-expanded={open} className={BLK_BTN} onClick={() => setOpen(!open)}>
                <Ellipsis className="size-icon-md" strokeWidth={1.75} aria-hidden />
              </button>
            ) : null
          }
        />
      </div>
      {more && open && (
        <div className="mx-1.5 mb-1.5 grid gap-3 rounded-sm bg-surface p-3 font-normal text-fg">
          {extras === null ? (
            <FieldFor f={{ name: "__json", kind: "json", label: t("Parameters (JSON)") }} s={{ __json: withoutType(step) }} set={(_f, v) => isRecord(v) && replaceParams(ctx, path, index, v)} />
          ) : (
            <>
              {type === "bind" && <BindField step={step} set={(n, x) => set(n, x)} />}
              {extras.map((f) => (
                <FieldFor key={f.name} f={f as never} s={step} set={set} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const isRecord = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const withoutType = (s: Obj): Obj => Object.fromEntries(Object.entries(s).filter(([k]) => k !== "type"));
const replaceParams = (ctx: Ctx, path: ListPath, index: number, v: Obj) =>
  ctx.logic.change((m) => {
    const list = listAt(m, path);
    const s = list[index];
    if (s) list[index] = { ...v, type: s.type };
  }, `step:${JSON.stringify(path)}:${index}:json`);

function CBlock({ ctx, path, index, step }: { ctx: Ctx; path: ListPath; index: number; step: Obj }) {
  const t = useT();
  const set = useSetter(ctx, path, index);
  const { defs, schema } = ctx.logic;
  const group = groupOf(groupsOf(schema), defs, String(step.type));
  const sub = (f: ListField): ListPath => [...path, index, f] as ListPath;
  const label = t((defs[String(step.type)]?.label as string | undefined) ?? String(step.type));
  const { ref, handleRef, isDragSource } = useStepDrag(path, index, label);
  const bar = (icon: typeof Split, words: ReactNode, f: ListField, plusLabel: string, tools?: boolean) => (
    <div className={cn("flex min-h-control-2xl items-center gap-2 pr-1 pl-2.5 font-semibold", ctx.wide ? "text-md" : "text-base", tools && "group/step")}>
      <span aria-hidden className="grid h-7.5 w-4.5 flex-none place-items-center text-cat-ink">
        {(() => {
          const I = icon;
          return <I className="size-icon-md" strokeWidth={1.75} />;
        })()}
      </span>
      <span className="flex min-h-7.5 min-w-0 flex-1 flex-wrap items-center gap-1.5">{words}</span>
      <IconButton icon={Plus} size="sm" label={plusLabel} title={t("Add step")} className="text-inherit" onClick={() => ctx.pick(sub(f), listOf(step, f).length)} />
      {tools ? (
        <Tools ctx={ctx} path={path} index={index} handle={handleRef} />
      ) : (
        <span aria-hidden className="invisible flex">
          <span className="w-6" />
          <span className={BLK_BTN} />
        </span>
      )}
    </div>
  );
  const body = (f: ListField) => (
    <div className="ml-4 rounded-l-md bg-field p-1.5">
      <Flow ctx={ctx} path={sub(f)} list={listOf(step, f)} />
    </div>
  );
  return (
    <div ref={ref} style={catStyle(group.color)} className={cn("rounded-lg bg-sunken text-fg inset-ring inset-ring-selected", isDragSource && "opacity-40")}>
      {step.type === "if" ? (
        <>
          {bar(
            Split,
            <>
              <InlineSelect
                label={t("If or if not")}
                options={[
                  ["", t("If")],
                  ["not", t("If not")],
                ]}
                value={step.is === false ? "not" : ""}
                onChange={(v) => set("is", v ? false : null)}
              />
              <CondEditor cond={readCond(step)} onChange={(c) => ctx.logic.change((m) => {
                const s = listAt(m, path)[index];
                if (!s) return;
                for (const f of ["value", "op", "to", "state"]) Reflect.deleteProperty(s, f);
                Object.assign(s, c);
              }, `step:${JSON.stringify(path)}:${index}:cond`)} />
            </>,
            "then",
            t("Add step to then"),
            true,
          )}
          {body("then")}
          {bar(CornerDownRight, <ChipLabel>{t("else")}</ChipLabel>, "else", t("Add step to else"))}
          {body("else")}
          <div className="h-2" />
        </>
      ) : step.type === "toggle" ? (
        <>
          {bar(ToggleRight, <ChipLabel>{t("when on")}</ChipLabel>, "on", t("Add step to when on"), true)}
          {body("on")}
          {bar(
            CornerDownRight,
            <>
              <ChipLabel>{t("when off")}</ChipLabel>
              <span className="text-xs font-normal opacity-80">{t("empty = same as when on")}</span>
            </>,
            "off",
            t("Add step to when off"),
          )}
          {body("off")}
          <div className="flex items-center gap-2 px-3 pt-1.5 pb-2.5 text-sm font-semibold">
            <W>{t("Turn on together with")}</W>
            <InlineInput
              type="text"
              minChars={10}
              maxChars={24}
              value={typeof step.state === "string" ? step.state : ""}
              placeholder={t("name (optional)")}
              aria-label={t("Turn on together with other keys")}
              title={t("Keys with the same name here turn on and off together")}
              onChange={(e) => set("state", e.target.value || null, true)}
            />
          </div>
        </>
      ) : (
        <>
          {bar(ListOrdered, <ChipLabel>{t("Sequence")}</ChipLabel>, "actions", t("Add step to the sequence"), true)}
          {body("actions")}
          <div className="h-2" />
        </>
      )}
    </div>
  );
}

const listOf = (step: Obj, f: ListField): Obj[] => (Array.isArray(step[f]) ? (step[f] as Obj[]) : []);

// ---------------------------------------------------------------------------- frases

function Sentence({ s, set, defs, t }: { s: Obj; set: Set; defs: Record<string, ActionDef>; t: T }) {
  const obs = useObs();
  const MODE: Record<string, [string, string][]> = {
    "obs.record": [["toggle", t("Start or stop")], ["start", t("Start")], ["stop", t("Stop")], ["pause", t("Pause or resume")]],
    "obs.stream": [["toggle", t("Start or stop")], ["start", t("Start")], ["stop", t("Stop")]],
    "obs.replay": [["toggle", t("Turn on or off")], ["start", t("Turn on")], ["stop", t("Turn off")], ["save", t("Save")]],
    "obs.virtualcam": [["toggle", t("Turn on or off")], ["start", t("Turn on")], ["stop", t("Turn off")]],
    "obs.mute": [["toggle", t("Mute or unmute")], ["on", t("Mute##2")], ["off", t("Unmute")]],
    "obs.source": [["toggle", t("Show or hide")], ["show", t("Show")], ["hide", t("Hide")]],
  };
  const mode = () => <InlMode s={s} set={set} options={MODE[String(s.type)] ?? []} />;
  switch (s.type) {
    case "hotkey":
      return (
        <>
          <W>{t("Press")}</W>
          <InlCombo s={s} set={set} />
        </>
      );
    case "bind":
      return (
        <>
          <W>{t("Unique shortcut")}</W>
          <span className="inline-flex h-control-sm items-center rounded-sm bg-selected px-2.25 text-sm font-semibold">{typeof s.keys === "string" ? s.keys : t("generating…")}</span>
        </>
      );
    case "text":
      return (
        <>
          <W>{t("Type")}</W>
          <InlText s={s} f="text" placeholder={t("text")} set={set} wide />
        </>
      );
    case "media":
      return <InlEnum s={s} f="key" set={set} defs={defs} />;
    case "launch":
      return (
        <>
          <W>{t("Open")}</W>
          <InlText s={s} f="target" placeholder={t("program, file or website")} set={set} wide />
        </>
      );
    case "command":
      return (
        <>
          <W>{t("Run")}</W>
          <InlText s={s} f="command" placeholder={t("command")} set={set} wide />
        </>
      );
    case "http":
      return (
        <>
          <W>{t("Call")}</W>
          <InlText s={s} f="url" placeholder="https://…" set={set} wide />
        </>
      );
    case "delay":
      return (
        <>
          <W>{t("Wait")}</W>
          <InlSeconds s={s} set={set} />
          <W>{t("seconds")}</W>
        </>
      );
    case "page":
      return (
        <>
          <W>{t("Go to page")}</W>
          <InlPage s={s} set={set} />
        </>
      );
    case "brightness":
      return (
        <>
          <W>{t("Brightness to")}</W>
          <InlNum s={s} f="value" placeholder="100" set={set} />
          <W>%</W>
        </>
      );
    case "set_state":
      return (
        <>
          <W>{t("Set")}</W>
          <InlState s={s} set={set} />
          <W>{t("as")}</W>
          <InlEnum s={s} f="value" set={set} defs={defs} />
        </>
      );
    case "none":
      return <W>{t("Do nothing")}</W>;
    case "obs.scene":
      return (
        <>
          <W>{t("Switch to scene")}</W>
          <InlText s={s} f="scene" placeholder={t("scene")} set={set} list={obs.scenes} />
        </>
      );
    case "obs.record":
      return (
        <>
          {mode()}
          <W>{t("recording")}</W>
        </>
      );
    case "obs.stream":
      return (
        <>
          {mode()}
          <W>{t("the live stream")}</W>
        </>
      );
    case "obs.replay":
      return (
        <>
          {mode()}
          <W>{t("the replay buffer")}</W>
        </>
      );
    case "obs.virtualcam":
      return (
        <>
          {mode()}
          <W>{t("the virtual camera")}</W>
        </>
      );
    case "obs.mute":
      return (
        <>
          {mode()}
          <InlText s={s} f="input" placeholder={t("audio source")} set={set} list={obs.inputs} />
          <W>{t("in OBS")}</W>
        </>
      );
    case "obs.source":
      return (
        <>
          {mode()}
          <InlText s={s} f="source" placeholder={t("source")} set={set} list={obs.sources[String(s.scene)] ?? []} />
          <W>{t("in scene")}</W>
          <InlText s={s} f="scene" placeholder={t("scene")} set={set} list={obs.scenes} />
        </>
      );
    case "obs.request":
      return (
        <>
          <W>{t("OBS command")}</W>
          <InlText s={s} f="request" placeholder={t("command name")} set={set} />
        </>
      );
    case "discord.mute":
      return <W>{t("Mute or unmute the Discord microphone")}</W>;
    case "discord.deafen":
      return <W>{t("Turn Discord audio on or off")}</W>;
    case "discord.keybind":
      return (
        <>
          <W>{t("Discord shortcut")}</W>
          <InlText s={s} f="name" placeholder={t("name")} set={set} />
        </>
      );
    case "light.flash":
      return (
        <>
          <W>{t("Light")}</W>
          <InlColor s={s} f="color" set={set} def="#22c55e" />
          <W>{t("for")}</W>
          <InlNum s={s} f="seconds" placeholder="3" set={set} />
          <W>s</W>
        </>
      );
    case "screens.paint":
      return (
        <>
          <W>{t("Paint the keys##card")}</W>
          <InlColor s={s} f="color" set={set} def="#b4232a" />
          <span className="inline-flex items-center gap-2">
            <W>{t("for")}</W>
            <InlNum s={s} f="seconds" placeholder="3" set={set} />
            <W>s</W>
          </span>
        </>
      );
    case "page.temp":
      return (
        <>
          <W>{t("Show the page")}</W>
          <InlPage s={s} set={set} />
          <W>{t("for")}</W>
          <InlNum s={s} f="seconds" placeholder="10" set={set} />
          <W>s</W>
        </>
      );
    case "timer.toggle":
      return (
        <>
          <W>{t("Start or pause the countdown")}</W>
          <InlText s={s} f="id" placeholder={t("name")} set={set} />
          <W>{t("of")}</W>
          <InlNum s={s} f="minutes" placeholder="5" set={set} />
          <W>min</W>
        </>
      );
    case "timer.reset":
      return (
        <>
          <W>{t("Reset the countdown")}</W>
          <InlText s={s} f="id" placeholder={t("name")} set={set} />
        </>
      );
    default:
      return <W>{defs[String(s.type)]?.label ? t(String(defs[String(s.type)]?.label)) : String(s.type)}</W>;
  }
}
