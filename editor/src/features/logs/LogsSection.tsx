// Tela "Logs" (o logs.js do editor atual): só mostra o que o app grava no app.log (gravado com a tela ligada ou
// não). Busca as linhas novas a cada 1,5 s; a lista é virtualizada (só desenha as linhas visíveis), então mostra
// todas as que o editor guardou. As mensagens ficam em inglês; a tela em volta segue o idioma do editor.
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Bug,
  ChevronDown,
  ChevronRight,
  CircleX,
  Copy,
  FileText,
  Info,
  Plug,
  PlugZap,
  Search,
  TriangleAlert,
  Usb,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { api } from "@/core/api";
import type { LogRecord, Problem } from "@/core/api-types";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import { norm } from "@/core/icons/lucide";
import type { Obj } from "@/core/obj";
import { useSchema, type Status } from "@/core/queries";
import { useUi } from "@/core/store/ui";
import { toast } from "@/core/toast";
import { useDebounced } from "@/core/useDebounced";
import { KEEP, fetchLogs, logTime, markSeen, useLogs } from "@/features/logs/store";

type T = ReturnType<typeof useT>;

export const logAreas = (t: T): [string, string, string][] => [
  ["keys", t("Keys"), t("press, release, double tap, repeat")],
  ["values", t("Values"), t("what changed, from what to what")],
  ["automations", t("Automations"), t("why it fired or not")],
  ["plugins", t("Plugins"), t("talking to OBS, Discord, Weather")],
  ["editor", t("Editor"), t("requests and response time")],
  ["device", t("Device"), t("USB, drawing the keys, light")],
];

const LV: Record<string, [LucideIcon, string]> = {
  ERROR: [CircleX, "bg-danger-bg text-danger-fg"],
  WARN: [TriangleAlert, "bg-warning-bg text-accent"],
  INFO: [Info, "bg-info-bg text-info-fg"],
  DEBUG: [Bug, "bg-sunken text-fg-subtle"],
};

function matches(r: LogRecord, level: string, area: string, q: string): boolean {
  if (level !== "all" && r.level !== level) return false;
  if (area && r.area !== area) return false;
  if (q && !norm(`${r.msg} ${r.area} ${r.tb ?? ""} ${r.ctx ? JSON.stringify(r.ctx) : ""}`).includes(norm(q))) return false;
  return true;
}

/** Ir para Config › Integrações (do problema ou do detalhe de uma linha de plugin). */
function useOpenIntegration() {
  const go = useUi((s) => s.go);
  return () => go({ section: "settings", setSection: "integrations" });
}

export function LogsSection() {
  const t = useT();
  const qc = useQueryClient();
  const st = useLogs();
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const [parent, setParent] = useState<HTMLElement | null>(null);
  const lastTop = useRef(0);
  const auto = useRef(false);
  const seen = () =>
    markSeen(() =>
      qc.setQueryData<Status>(["status"], (s) => (s ? ({ ...s, logs: { ...s.logs, new_errors: 0 } } as Status) : s)),
    );

  // primeira leitura e depois a cada 1,5 s, enquanto a tela está aberta
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        await fetchLogs();
        if (!alive) return;
        setErr(null);
        seen();
      } catch (e) {
        if (alive && !useLogs.getState().loaded) setErr((e as Error).message);
      }
      if (alive) timer = window.setTimeout(() => void tick(), 1500);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = useDebounced(st.q, 150);
  const list = useMemo(() => st.recs.filter((r) => matches(r, st.level, st.area, q)), [st.recs, st.level, st.area, q]);
  const areas = useMemo(() => [...new Set(st.recs.map((r) => r.area))].sort(), [st.recs]);

  // seguindo: desce até a última linha quando chega coisa nova
  useEffect(() => {
    if (!st.follow || !scroller.current) return;
    const el = scroller.current;
    auto.current = true;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      setTimeout(() => (auto.current = false), 60);
    });
  }, [list.length, st.follow]);

  if (!st.loaded) {
    return (
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <p className="m-0 text-xs text-fg-subtle">{err ? t("Couldn't read the log: {0}", [err]) : t("Loading…")}</p>
      </main>
    );
  }
  const d = st.detail;
  const names = logAreas(t);
  const mode = d?.force
    ? t("everything detailed (--debug)")
    : d?.detail
      ? d.areas.length
        ? t("Detailed: {0}", [d.areas.map((a) => names.find((x) => x[0] === a)?.[1] ?? a).join(", ")])
        : t("Detailed, no area chosen")
      : t("Normal");
  const count = (lv: string) => st.recs.filter((r) => r.level === lv).length;
  const levels: [string, string, LucideIcon?, number?, string?][] = [
    ["all", t("All")],
    ["ERROR", t("Errors"), CircleX, count("ERROR"), "text-danger-fg"],
    ["WARN", t("Warnings"), TriangleAlert, count("WARN"), "text-accent"],
    ["INFO", t("Info"), Info],
    ["DEBUG", t("Debug"), Bug],
  ];

  return (
    <main
      ref={(el) => {
        scroller.current = el;
        if (el !== parent) setParent(el);
      }}
      onScroll={(e) => {
        const el = e.currentTarget;
        // subiu com a rolagem: para de seguir
        if (el.scrollTop < lastTop.current - 4 && st.follow && !auto.current) useLogs.setState({ follow: false });
        lastTop.current = el.scrollTop;
      }}
      className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-6 pt-4.5 pb-7 scrollbar-stable *:flex-none"
    >
      <span className="-mt-1 text-sm text-fg-subtle">{t("{0}, recording since {1} ({2})", ["app.log", st.summary ? logTime(st.summary.since, false).slice(0, 5) : "--:--", mode])}</span>
      {st.problems.length > 0 && (
        <div className="flex flex-col gap-2">
          {st.problems.map((p) => (
            <ProblemCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <div role="group" aria-label={t("Level")} className="inline-flex gap-0.5 rounded-lg bg-sunken p-0.75">
          {levels.map(([v, l, icon, n, cls]) => (
            <button
              key={v}
              type="button"
              aria-pressed={st.level === v}
              onClick={() => useLogs.setState({ level: v })}
              className="inline-flex h-control-md cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-selected aria-pressed:text-fg not-aria-pressed:text-fg-muted not-aria-pressed:hover:bg-tint-hover not-aria-pressed:hover:text-fg"
            >
              {icon && <Icon icon={icon} />}
              {l}
              {n ? <span className={cn("font-bold", cls)}>{n}</span> : null}
            </button>
          ))}
        </div>
        <Select
          aria-label={t("Area")}
          value={st.area}
          onChange={(v) => useLogs.setState({ area: v })}
          options={[{ value: "", label: t("All areas") }, ...areas.map((a) => ({ value: a, label: a }))]}
          className="h-control-lg max-w-50"
        />
        <label className="flex h-control-lg max-w-90 min-w-50 flex-1 items-center gap-1.5 rounded-md border border-border-strong bg-field px-2.5 text-fg-subtle focus-within:border-accent">
          <Icon icon={Search} />
          <input
            type="search"
            value={st.q}
            placeholder={t("Search the log")}
            aria-label={t("Search the log")}
            onChange={(e) => useLogs.setState({ q: e.target.value })}
            className="h-8.5 min-w-0 flex-1 border-0 bg-transparent p-0 text-fg outline-none"
          />
        </label>
        <span className="flex-1" />
        <Button
          icon={ArrowDownToLine}
          aria-pressed={st.follow}
          title={t("Keep showing the newest lines")}
          onClick={() => useLogs.setState({ follow: !st.follow })}
          className="aria-pressed:border-accent aria-pressed:inset-ring aria-pressed:inset-ring-accent"
        >
          {t("Follow")}
        </Button>
        <Button icon={FileText} onClick={() => api("POST /api/open", { what: "log" }).catch((e: Error) => toast(e.message, { bad: true }))}>
          {t("Open file")}
        </Button>
      </div>
      <div role="table" aria-label={t("Log")} className="overflow-hidden rounded-xl border border-border bg-surface">
        <div role="row" className="grid min-h-control-md grid-cols-log-narrow items-center gap-3 bg-field px-3 text-xs font-semibold text-fg-subtle md:grid-cols-log">
          {[t("Time"), t("Level"), t("Area"), t("Message"), ""].map((x, i) => (
            <span key={i} role="columnheader" className={cn(i === 2 && "max-md:hidden")}>
              {x}
            </span>
          ))}
        </div>
        <div role="rowgroup">
          {list.length > 0 && parent && (
            <Virtuoso customScrollParent={parent} data={list} computeItemKey={(_i, r) => r.id} itemContent={(_i, r) => <LogRow r={r} open={st.open.has(r.id)} />} />
          )}
          {!list.length && <p className="m-0 px-3 py-3.5 text-xs text-fg-subtle">{st.recs.length ? t("No lines with these filters.") : t("Nothing here yet.")}</p>}
          {st.recs.length >= KEEP && <p className="m-0 px-3 py-3.5 text-xs text-fg-subtle">{t("Showing the last {0} lines. The file has everything.", [KEEP])}</p>}
        </div>
      </div>
      <p className="m-0 text-xs leading-4.25 text-fg-subtle">{t("Log messages are in English. Passwords and tokens show as ****. Click a line to see the details.")}</p>
    </main>
  );
}

function LogRow({ r, open }: { r: LogRecord; open: boolean }) {
  const [icon, cls] = LV[r.level] ?? (LV.INFO as [LucideIcon, string]);
  const more = !!(r.ctx || r.tb);
  const toggle = () =>
    useLogs.setState((s) => {
      const o = new Set(s.open);
      if (o.has(r.id)) o.delete(r.id);
      else o.add(r.id);
      return { open: o };
    });
  const cells = (
    <>
      <span className="font-mono text-xs text-fg-subtle">{logTime(r.t)}</span>
      <span className={cn("inline-flex h-control-xs w-17.5 items-center gap-1.5 rounded-sm px-1.75 text-2xs font-bold", cls)}>
        <Icon icon={icon} size="sm" />
        {r.level}
      </span>
      <span className="truncate text-xs font-semibold text-fg-muted max-md:hidden">{r.area}</span>
      <span className={cn("font-mono text-xs text-fg-label", open ? "py-1.75 break-words whitespace-normal" : "truncate")}>{r.msg}</span>
      <span className="grid text-fg-subtle">{more && <Icon icon={open ? ChevronDown : ChevronRight} />}</span>
    </>
  );
  const ROW = "grid min-h-control-lg w-full grid-cols-log-narrow items-center gap-3 border-b border-sunken px-3 text-left md:grid-cols-log";
  return (
    <div role="row">
      {more ? (
        <button type="button" aria-expanded={open} onClick={toggle} className={cn(ROW, "cursor-pointer hover:bg-sunken", open && "border-b-0 bg-sunken")}>
          {cells}
        </button>
      ) : (
        <div className={ROW}>{cells}</div>
      )}
      {open && <LogDetail r={r} />}
    </div>
  );
}

function LogDetail({ r }: { r: LogRecord }) {
  const t = useT();
  const schema = useSchema().data;
  const openIntegration = useOpenIntegration();
  const labels: Record<string, string> = { action: t("Action"), label: t("Name"), key: t("Key"), page: t("Page"), moment: t("Moment"), params: t("Parameters"), ms: t("Duration##log"), plugin: t("Plugin"), id: t("Problem") };
  const moments: Record<string, string> = { press: t("on press"), action: t("on press"), double: t("on double tap"), hold: t("on hold"), release: t("on release") };
  const val = (k: string, v: unknown) => (k === "ms" ? `${String(v)} ms` : k === "moment" ? (moments[String(v)] ?? String(v)) : typeof v === "object" ? JSON.stringify(v) : String(v));
  const ctx = r.ctx ?? {};
  const pid = typeof ctx.plugin === "string" ? ctx.plugin : r.area;
  const plugin = ((schema?.plugins ?? []) as Obj[]).find((p) => p.id === pid);
  const text = [`${logTime(r.t)} ${r.level} ${r.area} ${r.msg}`, ...Object.entries(ctx).map(([k, v]) => `  ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`), r.tb ?? ""].join("\n").trim();
  return (
    <div className="mx-3 mb-2.5 flex flex-col gap-3 rounded-md bg-canvas px-4 py-3.5 inset-ring inset-ring-border-strong">
      {Object.keys(ctx).length > 0 && (
        <dl className="m-0 grid grid-cols-kv gap-x-3.5 gap-y-1.5 text-sm">
          {Object.entries(ctx).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-subtle">{labels[k] ?? k}</dt>
              <dd className="m-0 font-semibold break-words">{val(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {r.tb && <pre className="m-0 overflow-x-auto rounded-sm bg-canvas px-3 py-2.5 font-mono text-xs whitespace-pre text-fg-label">{r.tb}</pre>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={Copy}
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => toast(t("Copied.")))
              .catch(() => toast(t("Couldn't copy."), { bad: true }))
          }
        >
          {t("Copy")}
        </Button>
        {plugin && (
          <Button size="sm" icon={Plug} onClick={openIntegration}>
            {t("Open Integrations › {0}", [String(plugin.name)])}
          </Button>
        )}
      </div>
    </div>
  );
}

function ProblemCard({ p }: { p: Problem }) {
  const t = useT();
  const schema = useSchema().data;
  const openIntegration = useOpenIntegration();
  const id = p.where?.startsWith("integrations:") ? p.where.slice(13) : null;
  const pl = id ? ((schema?.plugins ?? []) as Obj[]).find((x) => x.id === id) : undefined;
  const since = logTime(p.since, false).slice(0, 5);
  return (
    <div className="flex items-center gap-3.5 rounded-lg bg-danger-bg px-4 py-3 inset-ring inset-ring-danger-border">
      <Icon icon={p.id.startsWith("device") ? Usb : PlugZap} size="lg" className="text-danger-fg" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="text-base">{p.text}</b>
        <span className="text-xs leading-4.25 text-fg-subtle">{p.count > 1 ? t("Since {0}, {1} times.", [since, p.count]) : t("Since {0}.", [since])}</span>
      </div>
      {pl && (
        <Button size="sm" onClick={openIntegration}>
          {t("Open Integrations")}
        </Button>
      )}
    </div>
  );
}
