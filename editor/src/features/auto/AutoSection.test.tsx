import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { AutoSection } from "@/features/auto/AutoSection";
import { logicDrop } from "@/features/keys/drop";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/core/api", () => ({ api }));

const SCHEMA = { actions: { delay: { label: "Wait", group: "Other" }, page: { label: "Page", group: "Pages and logic" } }, plugin_groups: {}, plugins: [], values: [] };

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  api.mockReset();
  useConfig.getState().load({ pages: { main: {} } });
  useUi.setState({ section: "auto", page: "main" });
});
afterEach(cleanup);

const autos = () => useConfig.getState().cfg?.automations as Record<string, unknown>[] | undefined;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["schema"], SCHEMA);
  qc.setQueryData(["obs"], { connected: false, scenes: [], inputs: [], sources: {} });
  qc.setQueryData(["lucide-index"], {});
  render(
    <QueryClientProvider client={qc}>
      <AutoSection />
    </QueryClientProvider>,
  );
}

describe("Automações", () => {
  it("criar, escolher quando, pôr passos (o do vira uma ação só ou sequência), opções e apagar", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(autos()).toEqual([{ name: "", enabled: true, when: { type: "value", value: "", op: "eq", to: true }, do: [] }]);
    await user.click(screen.getByRole("button", { name: /^Time of day/ }));
    expect(autos()?.[0]?.when).toEqual({ type: "time", at: "18:00" });
    await act(async () => {
      await logicDrop.current?.({ kind: "new", type: "delay", label: "Wait" }, 'slot|["action"]|0');
    });
    expect(autos()?.[0]?.do).toEqual({ type: "delay", ms: 500 });
    await act(async () => {
      await logicDrop.current?.({ kind: "new", type: "delay", label: "Wait" }, 'slot|["action"]|1');
    });
    expect(autos()?.[0]?.do).toEqual({ type: "multi", actions: [{ type: "delay", ms: 500 }, { type: "delay", ms: 500 }] });
    await user.click(screen.getByRole("button", { name: "Weekend" }));
    await user.click(screen.getByRole("switch", { name: /^Turn on/ }));
    expect(autos()?.[0]).toMatchObject({ days: "weekend", enabled: false });
    await user.click(screen.getByRole("button", { name: "Delete automation" }));
    expect(autos()).toBeUndefined();
    expect(screen.getByText("Choose or create an automation on the left.")).toBeTruthy();
  });
});
