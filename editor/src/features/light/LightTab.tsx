// Aba "Luz" da tecla (o lightTab do editor atual): cada momento (apertar, segurar, soltar) com a própria reação
// do anel de LEDs, ou o padrão do painel de luz. Sem a luz ligada no app, avisa e leva até a tela Luz.
import { Info } from "lucide-react";
import { Button } from "@/components/Button";
import { NoteBox } from "@/components/NoteBox";
import { LabelRow, RangeRow } from "@/components/RangeRow";
import { Segmented } from "@/components/Segmented";
import { Swatches } from "@/components/Swatches";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import { isObj, type Obj } from "@/core/obj";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { ColorRow, Hint, SectionHead } from "@/features/keys/inspector/LookTab";
import { draftKeys } from "@/features/keys/keys";
import type { KeySpec } from "@/features/keys/model";
import { lightCfg, lightSettings, lightSwatches, reachName, reactionColor, reactionNames, speedName } from "@/features/light/settings";
import { AMBER, type Reaction } from "@/features/light/sim";
import { ReactionTile } from "@/features/light/ReactionTile";

type Moment = "press" | "hold" | "release";

export function LightTab({ page, k, spec }: { page: string; k: string; spec: KeySpec }) {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  const edit = useConfig((s) => s.edit);
  const moment = useUi((s) => s.lightMoment);
  const go = useUi((s) => s.go);
  const names = reactionNames(t);
  const moments: [Moment, string][] = [
    ["press", t("On press")],
    ["hold", t("On hold")],
    ["release", t("On release")],
  ];
  const light = isObj(spec.light) ? (spec.light as Record<string, Reaction>) : {};
  const cur: Reaction = light[moment] ?? {};
  const kind = cur.kind || "default";
  const st = lightSettings(cfg, page);

  const save = (r: Reaction | null, tag?: string) =>
    edit((d) => {
      const s = draftKeys(d, page)[k];
      if (!s) return;
      const l: Obj = isObj(s.light) ? { ...s.light } : {};
      if (!r || r.kind === "default") Reflect.deleteProperty(l, moment);
      else l[moment] = r;
      if (Object.keys(l).length) s.light = l;
      else Reflect.deleteProperty(s, "light");
    }, tag);
  const set = (key: keyof Reaction, v: unknown, tag?: string) => save({ kind, ...cur, [key]: v }, tag);

  const summary = (r: Reaction | undefined) => {
    if (!r?.kind || r.kind === "default") return t("Default");
    if (r.kind === "none" || r.kind === "hold") return names[r.kind] ?? r.kind;
    const color = r.color === "fixed" ? t("fixed color") : r.color === "effect" ? t("effect color") : t("key color");
    return `${names[r.kind] ?? r.kind}, ${color}`;
  };
  const kinds = ["default", "ripple", "point", "pulse", ...(moment === "hold" ? ["hold"] : [])];
  const color = reactionColor(cur.kind && cur.kind !== "default" ? cur : st.reaction, k, st, cfg, page);
  const label = (moments.find(([m]) => m === moment)?.[1] ?? "").toLowerCase();
  const adjNames: Record<string, string> = { ripple: t("wave"), point: t("dot"), pulse: t("pulse"), hold: t("lit light") };
  const tag = (key: string) => `light:${page}:${k}:${moment}:${key}`;

  return (
    <div className="grid gap-6 p-4">
      {!lightCfg(cfg) && (
        <NoteBox
          icon={Info}
          action={
            <Button size="sm" onClick={() => go({ section: "light" })}>
              {t("Open Light")}
            </Button>
          }
        >
          {t("The app doesn't control the Deck light yet. Turn it on in Light, in the left menu, for reactions to work.")}
        </NoteBox>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-fg-subtle">{t("Each moment has its own reaction")}</span>
        <Segmented
          variant="moments"
          label={t("Moment")}
          value={moment}
          onChange={(m) => go({ lightMoment: m })}
          options={moments.map(([m, l]) => ({ value: m, label: l, sub: summary(light[m]) }))}
        />
      </div>
      <section className="flex flex-col gap-2.5">
        <SectionHead title={t("Reaction {0}", [label])} />
        <div className={cn("grid gap-2", kinds.length > 4 ? "grid-cols-3" : "grid-cols-4")}>
          {kinds.map((kk) => (
            <ReactionTile key={kk} kind={kk} name={names[kk] ?? kk} pressed={kind === kk} color={color} onPick={() => save(kk === "default" ? null : { ...cur, kind: kk })} />
          ))}
        </div>
        <Hint>
          {moment === "press"
            ? t("Chosen here, it replaces the default reaction from the light panel. In Default, this key follows the panel (now: {0}).", [(names[st.reaction.kind] ?? "").toLowerCase()])
            : t("In Default, nothing happens in this moment: the default reaction only applies on press.")}
        </Hint>
      </section>
      {kind in adjNames && (
        <section className="flex flex-col gap-2.5">
          <SectionHead title={t("Settings for the {0}", [adjNames[kind]])} />
          <LabelRow label={t("Color")}>
            <Segmented
              variant="small"
              label={t("Color")}
              value={cur.color || "key"}
              onChange={(v) => set("color", v)}
              options={[
                { value: "key", label: t("From the key") },
                { value: "fixed", label: t("Fixed") },
                { value: "effect", label: t("From the effect") },
              ]}
            />
          </LabelRow>
          {cur.color === "fixed" && (
            <ColorRow label="">
              <Swatches label={t("Color")} value={cur.fixed || AMBER} onChange={(v) => set("fixed", v || AMBER)} colors={lightSwatches(t)} />
            </ColorRow>
          )}
          {kind !== "hold" && <RangeRow label={t("Speed")} value={cur.speed ?? 50} onChange={(v) => set("speed", v, tag("speed"))} shown={speedName(t)(cur.speed ?? 50)} />}
          {kind === "ripple" && (
            <RangeRow label={t("Reach")} min={10} max={100} value={cur.reach ?? 100} onChange={(v) => set("reach", v, tag("reach"))} shown={reachName(t)(cur.reach ?? 100)} />
          )}
        </section>
      )}
      <Hint>{t("Each moment keeps its own reaction and settings. On hold also offers “Lit while held”: the LEDs near the key stay lit until you let go.")}</Hint>
    </div>
  );
}
