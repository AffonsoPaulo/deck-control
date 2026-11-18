// Quadradinho de escolha de efeito ou reação, com a prévia animada (o .fx-card do editor atual). Na reação, a
// fita fica apagada e a reação sai do canto de baixo à direita a cada 2,4 s; "Padrão" mostra a reação do painel.
import { useMemo, type ReactNode } from "react";
import { cn } from "@/core/cn";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { lightSettings } from "@/features/light/settings";
import { AMBER, GEO_TILE, LIGHT_DEFAULTS, type Geo, type LightSettings, type LightSim } from "@/features/light/sim";
import { StripCanvas } from "@/features/light/strip";

const OFF: LightSettings = { ...LIGHT_DEFAULTS, effect: "off" };

export function FxCard({ pressed, onPick, children, preview, tile }: { pressed: boolean; onPick: () => void; children: ReactNode; preview: ReactNode; tile?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPick}
      className="flex cursor-pointer flex-col items-stretch gap-1.5 rounded-md border border-border bg-sunken px-1.5 pt-1.5 pb-2 text-center text-sm font-semibold text-fg hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:inset-ring aria-pressed:inset-ring-accent"
    >
      <span className={cn("relative block overflow-hidden rounded-sm bg-canvas", tile ? "h-9" : "h-10")}>{preview}</span>
      {children}
    </button>
  );
}

/** Dispara a reação de exemplo a cada 2,4 s (a de "segurar" apaga 1,3 s depois). */
function demo(kind: string, color: string) {
  let next = 0;
  return (now: number, sim: LightSim) => {
    if (now < next) return;
    next = now + 2.4;
    if (kind === "default") {
      const r = lightSettings(useConfig.getState().cfg, useUi.getState().page).reaction;
      if (r.kind !== "none") sim.react(16, r, color, now);
      return;
    }
    if (kind === "hold") sim.release(now);
    sim.react(16, { kind, speed: 55, reach: 100 }, color, now);
    if (kind === "hold") setTimeout(() => sim.release(performance.now() / 1000), 1300);
  };
}

export function ReactionTile({ kind, name, pressed, onPick, color = AMBER }: { kind: string; name: string; pressed: boolean; onPick: () => void; color?: string }) {
  const still = kind === "none";
  // o tick muda só quando muda o tipo ou a cor (senão a contagem dos 2,4 s recomeçaria a cada render)
  const tick = useTick(kind, color);
  return (
    <FxCard pressed={pressed} onPick={onPick} tile preview={<StripCanvas view={{ geo: GEO_TILE as Geo, fps: still ? 4 : 30, settings: () => OFF, brightness: () => 100, tick: still ? undefined : tick }} />}>
      {name}
    </FxCard>
  );
}

function useTick(kind: string, color: string) {
  return useMemo(() => demo(kind, color), [kind, color]);
}
