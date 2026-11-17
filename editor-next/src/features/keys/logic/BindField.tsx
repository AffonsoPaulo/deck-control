// Atalho único (bind, e as ações com atalho próprio, como as do Discord): a combinação gerada (F13–F24, que
// nenhum teclado tem), "gerar outra", para qual programa, enviar em 5 s, enviar pelo Deck (a próxima tecla do
// Deck manda só este atalho) e o aviso se outro lugar usa o mesmo atalho. Mesmas regras do editor atual
// (bindInput, sendComboButton, recordButton, conflictNote).
import { Keyboard, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { NoteBox } from "@/components/NoteBox";
import { Select } from "@/components/Select";
import { api } from "@/core/api";
import { useT } from "@/core/i18n";
import type { Obj } from "@/core/obj";
import { useSchema } from "@/core/queries";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { toast } from "@/core/toast";
import { actionDefs } from "@/features/keys/actions";
import { canonCombo, otherPlaces, useValidationState } from "@/core/validation";
import { placeText } from "@/features/keys/validation";

interface BindFieldProps {
  step: Obj; // o passo (type, keys, for)
  set: (field: string, value: unknown) => void;
  hint?: string | undefined; // o passo 2 da receita, quando o programa explica onde gravar o atalho
}

export function BindField({ step, set, hint }: BindFieldProps) {
  const t = useT();
  const page = useUi((s) => s.page);
  const k = useUi((s) => s.key);
  const schema = useSchema().data;
  const conflicts = useValidationState((s) => s.conflicts);
  const programs = ((schema?.plugins ?? []) as Obj[]).filter((pl) => pl.shortcut_rules);
  const rules = (s: Obj): Obj | null =>
    s.type === "bind"
      ? ((programs.find((x) => x.id === s.for)?.shortcut_rules as Obj | undefined) ?? null)
      : (((actionDefs(schema)[String(s.type)] as Obj | undefined)?.shortcut_rules as Obj | undefined) ?? null);
  const regen = async (s: Obj) => {
    try {
      const { combos } = await api("POST /api/free_bind", { config: useConfig.getState().cfg ?? {}, count: 1, rules: rules(s), taken: [] });
      if (combos[0]) set("keys", combos[0]);
    } catch (e) {
      toast(t("No free shortcuts left: ") + (e as Error).message, { bad: true });
    }
  };
  const combo = typeof step.keys === "string" ? step.keys : "";
  const others = combo ? otherPlaces(conflicts, combo, (pl) => pl.page === page && pl.key === k && pl.type === step.type) : [];
  return (
    <div className="grid gap-1.5">
      {step.type === "bind" && programs.length > 0 && (
        <div className="grid gap-1.5">
          <span className="text-sm font-medium text-fg-muted">{t("Made for")}</span>
          <Select
            aria-label={t("Made for")}
            value={typeof step.for === "string" ? step.for : ""}
            onChange={(v) => {
              set("for", v || null);
              void regen({ ...step, for: v || undefined });
            }}
            options={[{ value: "", label: t("Any program") }, ...programs.map((pl) => ({ value: String(pl.id), label: String(pl.name) }))]}
          />
          <span className="text-xs text-fg-subtle">{t("Some programs don't accept every combination: the shortcut is made with what this one accepts.")}</span>
        </div>
      )}
      <div className="relative flex items-center">
        <span className="flex min-h-control-lg min-w-0 flex-1 items-center rounded-md bg-selected pr-11 pl-3 text-base font-bold whitespace-nowrap text-fg">{combo || t("generating…")}</span>
        <IconButton
          icon={RefreshCw}
          label={t("Make another")}
          title={`${t("Make another")}: ${t("A new combination with F13–F24, which no keyboard has")}`}
          className="absolute top-1/2 right-0.75 size-7.5 -translate-y-1/2 rounded-sm bg-raised"
          onClick={() => void regen(step)}
        />
      </div>
      <SendRow combo={combo} />
      {others.length > 0 && (
        <NoteBox icon={TriangleAlert} tone="bad" className="mt-2">
          {t("This shortcut is also used in {0}. Click ↻ to make another, so each one does only one thing.", [others.map((p) => placeText(t, schema, p)).join("; ")])}
        </NoteBox>
      )}
      <ol className="m-0 grid list-decimal gap-0.5 pl-5 text-sm text-fg-muted">
        <li>{t("Save.")}</li>
        <li>{hint ? `${hint}.` : t("In the other program, click the record-shortcut field.")}</li>
        <li>{t("Press this Deck key (or use Send with the Deck).")}</li>
      </ol>
    </div>
  );
}

/** "Enviar em 5 s" e "Enviar pelo Deck": jeitos de o outro programa gravar este atalho. */
/** O passo usa um atalho que outro lugar também usa? (marca a linha e abre as opções, onde está o aviso) */
export function useClash(step: Obj): boolean {
  const conflicts = useValidationState((s) => s.conflicts);
  return typeof step.keys === "string" && conflicts.some((c) => c.combo === canonCombo(step.keys));
}

export function SendRow({ combo }: { combo: string }) {
  const t = useT();
  const [count, setCount] = useState<number | null>(null);
  const [listen, setListen] = useState<number | null>(null); // segundos que faltam (enviar pelo Deck)
  const started = useRef(0);
  useEffect(() => {
    if (count === null) return;
    const id = setTimeout(() => setCount(count > 0 ? count - 1 : count === 0 ? -1 : null), count >= 0 ? 1000 : 1500);
    return () => clearTimeout(id);
  }, [count]);
  useEffect(() => {
    if (listen === null) return;
    const id = setInterval(async () => {
      try {
        const r = await api("GET /api/record");
        if (r.sent && r.sent.at >= started.current) {
          setListen(null);
          toast(t("Sent {0} through key {1}.", [r.sent.combo, r.sent.key]));
        } else if (!r.armed) setListen(null);
        else setListen(r.left);
      } catch {
        setListen(null);
      }
    }, 500);
    return () => clearInterval(id);
  }, [listen === null, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!combo) return;
    try {
      await api("POST /api/send_combo", { keys: combo, delay: 5 });
      setCount(5);
    } catch (e) {
      toast((e as Error).message, { bad: true });
    }
  };
  const record = async () => {
    if (listen !== null) {
      setListen(null);
      try {
        await api("POST /api/record", { cancel: true });
      } catch {
        /* já parou */
      }
      return;
    }
    if (!combo) return;
    try {
      await api("POST /api/record", { keys: combo, seconds: 30 });
      started.current = Date.now() / 1000 - 1;
      setListen(30);
    } catch (e) {
      toast((e as Error).message, { bad: true });
    }
  };
  const sendLabel = count === null ? t("Send in 5 s") : count > 0 ? t("Sending in {0}…", [count]) : t("Sent");
  return (
    <>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button size="sm" icon={Send} disabled={count !== null} title={t("Click here, then on the shortcut field of the other program")} onClick={() => void send()} className="min-h-control-lg w-full justify-center">
          {sendLabel}
        </Button>
        <Button
          size="sm"
          icon={Keyboard}
          title={t("For the other program to record this shortcut without hurrying: the next Deck key you press sends only this shortcut. No key action runs.")}
          onClick={() => void record()}
          className="min-h-control-lg w-full justify-center"
        >
          {listen !== null ? t("Cancel") : t("Send with the Deck")}
        </Button>
      </div>
      {listen !== null && (
        <NoteBox icon={Keyboard} status>
          {t("Now go to the other program, click to record a shortcut and press any Deck key. It will send only {0}: no action runs and nothing changes on the Deck. {1} s left.", [combo, listen])}
        </NoteBox>
      )}
    </>
  );
}
