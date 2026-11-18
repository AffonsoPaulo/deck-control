// O que a tela Logs já leu do app.log (o LOGS do editor atual): as linhas (até 3.000; o arquivo tem tudo), o
// resumo, os problemas e os filtros. Fica guardado ao trocar de tela; ao voltar, só busca o que veio depois.
import { create } from "zustand";
import { api } from "@/core/api";
import type { LogDetail, LogFiles, LogRecord, LogSummary, Problem } from "@/core/api-types";

export const KEEP = 3000;

interface LogsState {
  recs: LogRecord[];
  last: number;
  summary: LogSummary | null;
  problems: Problem[];
  files: LogFiles | null;
  detail: LogDetail | null;
  loaded: boolean;
  level: string; // all | ERROR | WARN | INFO | DEBUG
  area: string;
  q: string;
  follow: boolean;
  open: Set<number>;
}

export const useLogs = create<LogsState>()(() => ({
  recs: [],
  last: 0,
  summary: null,
  problems: [],
  files: null,
  detail: null,
  loaded: false,
  level: "all",
  area: "",
  q: "",
  follow: true,
  open: new Set(),
}));

/** Busca as linhas novas. O app reiniciou (os números recomeçaram): começa de novo. Devolve as novas. */
export async function fetchLogs(): Promise<LogRecord[]> {
  const { last } = useLogs.getState();
  const r = await api("GET /api/logs", { after: String(last) });
  const fresh = r.records;
  if (!fresh.length && r.summary.last < last) {
    useLogs.setState({ recs: [], last: 0, open: new Set() });
    return fetchLogs();
  }
  useLogs.setState((s) => {
    const recs = fresh.length ? [...s.recs, ...fresh].slice(-KEEP) : s.recs;
    return { recs, last: fresh.length ? (fresh[fresh.length - 1] as LogRecord).id : s.last, summary: r.summary, problems: r.problems, files: r.files, detail: r.detail, loaded: true };
  });
  return fresh;
}

/** Marca como visto até a última linha lida (zera o número de erros novos no trilho). */
export function markSeen(onSeen: () => void) {
  const { summary, last } = useLogs.getState();
  if (!summary || summary.seen >= last) return;
  api("POST /api/logs/seen", { upto: last }).catch(() => {});
  useLogs.setState({ summary: { ...summary, seen: last, new_errors: 0 } });
  onSeen();
}

const pad2 = (n: number) => String(n).padStart(2, "0");
export function logTime(t: number, ms = true): string {
  const d = new Date(t * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` + (ms ? `.${String(d.getMilliseconds()).padStart(3, "0")}` : "");
}
