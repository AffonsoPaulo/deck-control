// Histórico de versões (o openHistory do editor atual): cada vez que algo é salvo, uma versão fica guardada; as
// mudanças feitas em seguida entram na mesma. "Voltar para esta" pede um segundo clique para confirmar.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Sheet, SheetHead } from "@/components/Sheet";
import { api } from "@/core/api";
import type { HistoryEntry } from "@/core/api-types";
import { cn } from "@/core/cn";
import { i18n, useT } from "@/core/i18n";
import { flushSave } from "@/core/store/autosave";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { toast } from "@/core/toast";

type T = ReturnType<typeof useT>;

function dayLabel(t: T, ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t("Today");
  if (d.toDateString() === y.toDateString()) return t("Yesterday");
  return d.toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" });
}
function agoLabel(t: T, ts: number, now: number): string {
  const s = Math.round(now / 1000 - ts);
  if (s < 60) return t("just now");
  if (s < 3600) return t("{0} min ago", [Math.round(s / 60)]);
  if (s < 86400) return t("{0} h ago", [Math.round(s / 3600)]);
  return "";
}

export function HistorySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const q = useQuery({
    queryKey: ["history"],
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    // salva o que está pendente antes: a versão de agora entra na lista
    queryFn: async () => {
      await flushSave();
      return (await api("GET /api/history")).entries;
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={t("History")} className="w-155">
      <SheetHead>
        <h2 className="m-0 text-xl font-bold">{t("History")}</h2>
      </SheetHead>
      <p className="m-0 mb-3.5 text-xs text-fg-subtle">{t("Every time something is saved, a version is kept here. Changes made in a row go into the same version.")}</p>
      {q.isPending ? (
        <p className="m-0 text-xs text-fg-subtle">{t("Loading…")}</p>
      ) : q.isError ? (
        <p className="m-0">{t("Error loading the history: ") + q.error.message}</p>
      ) : q.data.length ? (
        <List entries={q.data} onDone={() => onOpenChange(false)} />
      ) : (
        <p className="m-0">{t("No versions saved yet.")}</p>
      )}
    </Sheet>
  );
}

function List({ entries, onDone }: { entries: HistoryEntry[]; onDone: () => void }) {
  const t = useT();
  const [now] = useState(() => Date.now());
  const days = entries.map((e) => dayLabel(t, e.time));
  return (
    <div className="grid gap-0.5 overflow-auto">
      {entries.map((e, i) => {
        const day = days[i] ?? "";
        const head = i === 0 || day !== days[i - 1];
        return (
          <div key={e.id} className="contents">
            {head && <h3 className="m-0 mt-3.5 mb-1 text-xs font-semibold text-fg-subtle first:mt-0">{day}</h3>}
            <Item e={e} current={i === 0} now={now} onDone={onDone} />
          </div>
        );
      })}
    </div>
  );
}

function Item({ e, current, now, onDone }: { e: HistoryEntry; current: boolean; now: number; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [armed, setArmed] = useState(false);
  const time = new Date(e.time * 1000).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
  const items = e.summary.slice(0, 4);
  const restore = async () => {
    if (!armed) return setArmed(true);
    try {
      const r = await api("POST /api/history/restore", { id: e.id });
      // o servidor já gravou: o editor recomeça desse config
      useConfig.getState().load(r.config);
      useUi.getState().go({ key: null, expanded: false });
      qc.removeQueries({ queryKey: ["preview"] });
      onDone();
      toast(t("Went back to the version from {0}. Changed your mind? Just open the history again.", [r.when]));
    } catch (err) {
      toast(t("Couldn't go back: ") + (err as Error).message, { bad: true });
    }
  };
  return (
    <div className={cn("grid grid-cols-history items-start gap-3 rounded-md p-2.5", current ? "bg-success-bg" : "hover:bg-sunken")}>
      <div>
        <b className="block text-base">{time}</b>
        <small className="text-xs text-fg-subtle">{agoLabel(t, e.time, now)}</small>
      </div>
      <div>
        {e.reason && <b className="mb-0.5 block">{e.reason}</b>}
        <ul className="m-0 pl-4 text-sm text-fg-muted">
          {items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
          {e.summary.length > 4 && <li className="text-xs text-fg-subtle">{t("and {0} more", [e.summary.length - 4])}</li>}
        </ul>
      </div>
      {current ? (
        <span className="pt-1 text-xs font-semibold whitespace-nowrap text-success-fg">{t("Current version")}</span>
      ) : (
        <Button size="sm" variant={armed ? "primary" : "default"} onClick={() => void restore()}>
          {armed ? t("Click again to confirm") : t("Go back to this one")}
        </Button>
      )}
    </div>
  );
}
