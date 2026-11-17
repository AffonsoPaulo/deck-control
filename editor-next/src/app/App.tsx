// Fase 0: só a casca, para provar o caminho inteiro (tokens, Tailwind, build, /next servido pelo Python, token, API).
import { useEffect, useState } from "react";
import type { StatusOffline, StatusOnline } from "@/core/api-types";
import { cn } from "@/core/cn";
import { readToken } from "@/core/token";

type Status = StatusOffline | StatusOnline;

const NO_TOKEN = "Abra pelo endereço do app (com o token no fim).";

export function App() {
  const [token] = useState(readToken);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(token ? null : NO_TOKEN);

  useEffect(() => {
    if (!token) return;
    fetch("/api/status", { headers: { "X-Token": token } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setStatus((await r.json()) as Status);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  return (
    <main className="min-h-dvh bg-canvas p-6 text-fg">
      <section className="max-w-prose rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h1 className="text-lg font-sans">Editor novo do Deck</h1>
        <p className="mt-2 text-sm text-fg-muted">Em construção. O editor de sempre continua em /.</p>
        <p
          className={cn(
            "mt-4 rounded-md px-3 py-2 text-sm",
            error ? "bg-danger-bg text-danger-fg" : "bg-sunken text-fg-label",
          )}
        >
          {error ?? (status ? (status.engine ? "App rodando." : "App fechado: só o editor está aberto.") : "Conectando…")}
        </p>
      </section>
    </main>
  );
}
