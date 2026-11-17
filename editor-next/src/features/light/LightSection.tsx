// Tela "Luz" (o renderLightView do editor atual): o Deck com a fita em volta (clicar numa tecla mostra a reação
// dela), os efeitos, o geral (ligar a luz pelo app, brilho, cada página com a sua, apagar com a tela), os ajustes do
// efeito e a reação padrão das teclas. Com a luz desligada no app, só o geral responde.
import { RotateCcw, RotateCw } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { InlineSelect } from "@/components/Inline";
import { LabelRow, RangeRow } from "@/components/RangeRow";
import { Segmented } from "@/components/Segmented";
import { Swatches } from "@/components/Swatches";
import { Switch } from "@/components/Switch";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import { clone } from "@/core/obj";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { ColorRow, Hint } from "@/features/keys/inspector/LookTab";
import { useCurrentPage } from "@/features/keys/currentPage";
import { pageKeysOf, pagesOf } from "@/features/keys/model";
import { isCells, usePagePreviews } from "@/features/keys/previews";
import { FxCard, ReactionTile } from "@/features/light/ReactionTile";
import {
  effectInfo,
  lightCfg,
  lightGroups,
  lightSettings,
  lightSwatches,
  qtyName,
  reachName,
  reactionColor,
  reactionNames,
  setLight,
  setReaction,
  sizeName,
  speedName,
} from "@/features/light/settings";
import { AMBER, GEO_BIG, GEO_MINI, KEY_LED, LIGHT_DEFAULTS, LightSim, type Reaction } from "@/features/light/sim";
import { StripCanvas } from "@/features/light/strip";

const KEYS = Array.from({ length: 15 }, (_, i) => String(i + 1));

/** Clicou numa tecla do palco: a reação dela (a própria, se tiver, ou a padrão) sai do LED mais perto. */
function pressKey(sim: LightSim, page: string, k: string) {
  const c = useConfig.getState().cfg;
  if (!lightCfg(c)) return;
  const s = lightSettings(c, page);
  const spec = pageKeysOf(c, page)[k];
  const pr = (spec?.light as { press?: Reaction } | undefined)?.press;
  const rr: Reaction = pr?.kind && pr.kind !== "default" ? pr : s.reaction;
  if (rr.kind && rr.kind !== "none") sim.react(KEY_LED[k] ?? 0, rr, reactionColor(rr, k, s, c, page), performance.now() / 1000);
}

/** Cartão da tela Luz: `sub` fica colado ao título; `aside`, na ponta direita. */
function LvCard({ title, sub, aside, off, children }: { title: string; sub?: string; aside?: ReactNode; off?: boolean; children: ReactNode }) {
  return (
    <section inert={off} className={cn("flex min-w-0 flex-col gap-3.5 rounded-xl bg-surface p-4.5 inset-ring inset-ring-border", off && "opacity-45")}>
      <div className="flex items-baseline gap-2">
        <h2 className="m-0 text-md font-bold text-fg">{title}</h2>
        {sub && <span className="text-sm text-fg-subtle">{sub}</span>}
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  );
}

export function LightSection() {
  const page = useCurrentPage();
  if (page === null) return null;
  return <LightView page={page} />;
}

function LightView({ page }: { page: string }) {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  const edit = useConfig((s) => s.edit);
  const go = useUi((s) => s.go);
  const previews = usePagePreviews(page);
  const raw = lightCfg(cfg);
  const on = !!raw;
  const st = lightSettings(cfg, page);
  const sim = useMemo(() => new LightSim(), []);
  const keys = pageKeysOf(cfg, page);
  const info = effectInfo(t);
  const names = reactionNames(t);
  const swatches = lightSwatches(t);
  const fx = info[st.effect] ?? info.solid ?? { name: "", params: "" };
  const p = fx.params;
  const r = st.reaction;
  const live = () => {
    const c = useConfig.getState().cfg;
    return lightCfg(c) ? lightSettings(c, page) : { ...LIGHT_DEFAULTS, effect: "off" };
  };
  const tag = (k: string) => `lighting:${k}`;

  return (
    <main className="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-auto p-6 scrollbar-stable lg:grid-cols-2 xl:grid-cols-3">
      <section className="deck-lv-stage col-span-full xl:col-span-2">
        <div className="deck-lv-device">
          <StripCanvas view={{ sim, geo: GEO_BIG, settings: live }} />
          <div className="deck-lv-body">
            <div className="deck-lv-keys">
              {KEYS.map((k) => {
                const pv = previews?.[Number(k) - 1];
                const img = pv && !isCells(pv) ? pv.normal : null;
                return (
                  <button
                    key={k}
                    type="button"
                    className="deck-lv-key"
                    data-empty={keys[k] ? undefined : ""}
                    aria-label={t("Key {0}: see the reaction", [k])}
                    title={t("Click to see this key's reaction")}
                    onPointerDown={() => pressKey(sim, page, k)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pressKey(sim, page, k)}
                  >
                    {img && <img src={img} alt="" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <p className="m-0 text-sm text-fg-subtle">{on ? t("Click a key to see its reaction.") : t("The Deck light isn't controlled by the app yet. Turn it on in General.")}</p>
      </section>

      <LvCard
        title={t("Effect")}
        off={!on}
        aside={
          st.per_page ? (
            <PagePicker page={page} onPick={(pg) => go({ page: pg, key: null })} />
          ) : (
            <span className="text-sm text-fg-subtle">{t("{0} effects", [15])}</span>
          )
        }
      >
        {lightGroups(t).map(([gname, items]) => (
          <div key={gname} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-fg-subtle">{gname}</span>
            <div className="grid grid-cols-3 gap-2">
              {items.map(([k, name]) => (
                <FxCard
                  key={k}
                  pressed={st.effect === k}
                  onPick={() => setLight(page, "effect", k)}
                  preview={<StripCanvas view={{ geo: GEO_MINI, fps: 24, settings: () => ({ ...live(), effect: k }), brightness: () => 100 }} />}
                >
                  {name}
                </FxCard>
              ))}
            </div>
          </div>
        ))}
      </LvCard>

      <LvCard title={t("General")}>
        <Switch
          label={t("Control the Deck light")}
          checked={on}
          onChange={(v) =>
            edit((d) => {
              if (v) d.lighting = clone(lightCfg(d)) ?? { effect: "solid", color: AMBER, brightness: 80, reaction: { kind: "ripple", color: "key" } };
              else Reflect.deleteProperty(d, "lighting");
            })
          }
        />
        <div inert={!on} className={cn("flex flex-col gap-3.5", !on && "opacity-45")}>
          <RangeRow label={t("Brightness")} value={st.brightness} onChange={(v) => setLight(page, "brightness", v, tag("brightness"))} shown={`${st.brightness}%`} />
          <Switch label={t("Each page with its own light")} checked={!!st.per_page} onChange={(v) => setLight(page, "per_page", v)} />
          <Switch label={t("Turn off with the PC screen")} checked={st.off_with_screen !== false} onChange={(v) => setLight(page, "off_with_screen", v)} />
        </div>
        <Hint>{t("Two quick clicks on the Deck back button hand the light over to the app. A single click switches to the device's own effects.")}</Hint>
      </LvCard>

      <LvCard title={t("Settings##2")} off={!on} sub={fx.name}>
        {p.includes("c") && (
          <ColorRow label={p.includes("2") ? t("Color 1") : t("Color")}>
            <Swatches label={t("Color")} value={st.color} onChange={(v) => setLight(page, "color", v || AMBER)} colors={swatches} />
          </ColorRow>
        )}
        {p.includes("2") && (
          <ColorRow label={t("Color 2")}>
            <Swatches label={t("Color 2")} value={st.color2} onChange={(v) => setLight(page, "color2", v || "#E5701A")} colors={swatches} />
          </ColorRow>
        )}
        {p.includes("s") && <RangeRow label={t("Speed")} value={st.speed} onChange={(v) => setLight(page, "speed", v, tag("speed"))} shown={speedName(t)(st.speed)} />}
        {p.includes("z") && (
          <RangeRow
            label={st.effect === "comet" ? t("Trail") : st.effect === "stars" || st.effect === "sparks" ? t("Amount") : t("Size")}
            value={st.size}
            onChange={(v) => setLight(page, "size", v, tag("size"))}
            shown={(st.effect === "comet" ? sizeName(t) : qtyName(t))(st.size)}
          />
        )}
        {p.includes("d") && (
          <LabelRow label={t("Direction")}>
            <Segmented
              variant="small"
              label={t("Direction")}
              value={st.direction}
              onChange={(v) => setLight(page, "direction", v)}
              options={[
                { value: "cw", label: t("Clockwise"), icon: RotateCw },
                { value: "ccw", label: t("Counterclockwise"), icon: RotateCcw },
              ]}
            />
          </LabelRow>
        )}
        {!p && <Hint>{t("With the light off, there's nothing to adjust. Key reactions keep working.")}</Hint>}
      </LvCard>

      <LvCard title={t("Default key reaction")} off={!on}>
        <div className="grid grid-cols-4 gap-2">
          {["none", "ripple", "point", "pulse"].map((k) => (
            <ReactionTile key={k} kind={k} name={names[k] ?? k} pressed={r.kind === k} onPick={() => setReaction("kind", k)} />
          ))}
        </div>
        {r.kind !== "none" && (
          <>
            <LabelRow label={t("Color")}>
              <Segmented
                variant="small"
                label={t("Color")}
                value={r.color || "key"}
                onChange={(v) => setReaction("color", v)}
                options={[
                  { value: "key", label: t("From the key") },
                  { value: "fixed", label: t("Fixed") },
                  { value: "effect", label: t("From the effect") },
                ]}
              />
            </LabelRow>
            {r.color === "fixed" && (
              <ColorRow label="">
                <Swatches label={t("Color")} value={r.fixed || AMBER} onChange={(v) => setReaction("fixed", v || AMBER)} colors={swatches} />
              </ColorRow>
            )}
            <RangeRow label={t("Speed")} value={r.speed ?? 50} onChange={(v) => setReaction("speed", v, tag("r-speed"))} shown={speedName(t)(r.speed ?? 50)} />
            {r.kind === "ripple" && (
              <RangeRow label={t("Reach")} min={10} max={100} value={r.reach ?? 100} onChange={(v) => setReaction("reach", v, tag("r-reach"))} shown={reachName(t)(r.reach ?? 100)} />
            )}
          </>
        )}
        <Hint>{t("Applies to every key on press. A key with its own reaction, in its Light tab, uses its own.")}</Hint>
      </LvCard>
    </main>
  );
}

/** Para qual página é a luz (com cada página com a sua). */
function PagePicker({ page, onPick }: { page: string; onPick: (p: string) => void }) {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  return (
    <span title={t("Which page this light is for")}>
      <InlineSelect
        label={t("Light page")}
        value={page}
        options={Object.keys(pagesOf(cfg)).map((p) => [p, t("Page {0}", [p])] as [string, string])}
        onChange={(v) => onPick(String(v))}
      />
    </span>
  );
}
