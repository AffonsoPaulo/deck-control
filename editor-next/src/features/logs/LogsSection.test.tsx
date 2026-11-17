import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogsSection } from "@/features/logs/LogsSection";
import { useLogs } from "@/features/logs/store";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/core/api", () => ({ api }));
// jsdom não mede: a lista virtualizada desenha tudo
vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>({ data, itemContent }: { data: T[]; itemContent: (i: number, row: T) => ReactNode }) => <div>{data.map((r, i) => <div key={i}>{itemContent(i, r)}</div>)}</div>,
}));

const T0 = 1795455120;
const recs = [
  { id: 1, t: T0, level: "INFO", area: "keys", msg: "pressed key 4", ctx: null, tb: null },
  { id: 2, t: T0 + 1, level: "ERROR", area: "obs", msg: "OBS connection failed", ctx: { plugin: "obs", moment: "hold", ms: 12 }, tb: "Traceback: boom" },
];
const resp = (records: unknown[], last: number, seen = 0) => ({
  records,
  summary: { last, seen, new_errors: 1, errors: 1, warnings: 0, since: T0 },
  problems: [],
  files: { folder: "x", file: "app.log", count: 1, bytes: 10 },
  detail: { detail: false, areas: [], force: false },
});

beforeEach(() => {
  api.mockReset();
  useLogs.setState({ recs: [], last: 0, summary: null, problems: [], files: null, detail: null, loaded: false, level: "all", area: "", q: "", follow: true, open: new Set() });
});
afterEach(cleanup);

describe("Logs", () => {
  it("lê as linhas, marca como visto, filtra por nível e busca, e abre o detalhe", async () => {
    api.mockImplementation((route: string) => Promise.resolve(route === "GET /api/logs" ? resp(recs, 2) : { ok: true }));
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LogsSection />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("pressed key 4")).toBeTruthy();
    await waitFor(() => expect(api).toHaveBeenCalledWith("POST /api/logs/seen", { upto: 2 }));
    await user.click(screen.getByRole("button", { name: /^Errors/ }));
    expect(screen.queryByText("pressed key 4")).toBeNull();
    await user.click(screen.getByRole("button", { name: /OBS connection failed/ }));
    expect(screen.getByText("on hold")).toBeTruthy();
    expect(screen.getByText("12 ms")).toBeTruthy();
    expect(screen.getByText("Traceback: boom")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(await screen.findByText("No lines with these filters.")).toBeTruthy();
  });

  it("o app reiniciou (números recomeçaram): começa a lista de novo", async () => {
    const { fetchLogs } = await import("@/features/logs/store");
    useLogs.setState({ recs: recs as never, last: 50 });
    api.mockResolvedValueOnce(resp([], 3)).mockResolvedValueOnce(resp(recs.slice(0, 1), 1));
    await fetchLogs();
    expect(api).toHaveBeenNthCalledWith(2, "GET /api/logs", { after: "0" });
    expect(useLogs.getState().recs.map((r) => r.id)).toEqual([1]);
  });
});
