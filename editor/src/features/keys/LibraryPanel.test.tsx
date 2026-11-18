import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { useToast } from "@/core/toast";
import { useLib } from "@/features/keys/libStore";
import { LibraryPanel } from "@/features/keys/LibraryPanel";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/core/api", () => ({ api }));

const SCHEMA = {
  actions: {
    hotkey: { label: "Keyboard shortcut", group: "Keyboard and text", help: "Press keys" },
    media: { label: "Media", group: "Programs and system", fields: [{ name: "key", kind: "enum", required: true, options: [["play_pause", "Play"]] }] },
    multi: { label: "Seq" },
  },
  plugin_groups: {},
  plugins: [{ id: "weather", name: "Clima" }],
  values: [],
  widgets: {
    "app.clock": { label: "Clock", category: "time", plugin: null, sizes: { "1x1": {}, "2x2": {} } },
    "weather.now": { label: "Weather", category: "weather", plugin: "weather", sizes: { "1x1": {} } },
  },
  widget_categories: [
    { id: "time", label: "Time", color: "var(--cat-violet)" },
    { id: "weather", label: "Weather", color: "var(--cat-sky)" },
  ],
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  api.mockReset();
  api.mockImplementation((route: string) => Promise.resolve(route === "POST /api/preview" ? { images: [] } : { combos: [] }));
  useConfig.getState().load({ pages: { main: { "4": { icon: { text: "Meu" }, action: "hotkey:a" } } }, saved_keys: [{ name: "Guardada", key: { icon: { text: "G" } } }] });
  useUi.setState({ page: "main", key: null });
  useLib.setState({ tab: "actions", open: ["Keyboard and text"], origin: "all", widgetOpen: [] });
  useToast.setState({ current: null, leaving: false });
});
afterEach(cleanup);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["schema"], SCHEMA);
  qc.setQueryData(["obs"], { connected: false, scenes: [], inputs: [], sources: {} });
  qc.setQueryData(["lucide-index"], {});
  return render(
    <QueryClientProvider client={qc}>
      <LibraryPanel page="main" />
    </QueryClientProvider>,
  );
}

describe("LibraryPanel: Ações", () => {
  it("grupos em sanfona; o aberto mostra as ações; teclas guardadas no fim", () => {
    setup();
    expect(screen.getByRole("button", { name: /Keyboard and text/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Programs and system/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Keyboard shortcut" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Media" })).toBeNull();
    expect(screen.getByRole("button", { name: /Saved keys/ })).toBeTruthy();
  });

  it("sem tecla escolhida, clicar numa ação explica o que fazer", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Keyboard shortcut" }));
    expect(useToast.getState().current?.msg).toBe("Click a key first, or drag the action onto it.");
  });

  it("com tecla escolhida, clicar põe a ação nela (desfazer volta)", async () => {
    const user = userEvent.setup();
    useUi.setState({ key: "9" });
    setup();
    await user.click(screen.getByRole("button", { name: "Keyboard shortcut" }));
    await waitFor(() => expect((useConfig.getState().cfg?.pages as Record<string, Record<string, unknown>>).main?.["9"]).toBeTruthy());
    expect(useToast.getState().current?.msg).toBe("Key 9 created: Keyboard shortcut.");
    useConfig.getState().undo();
    expect((useConfig.getState().cfg?.pages as Record<string, Record<string, unknown>>).main?.["9"]).toBeUndefined();
  });

  it("buscando, abre tudo e as abas mostram quantos acharam", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole("searchbox"), "media");
    expect(screen.getByRole("button", { name: "Media" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Actions/ }).textContent).toContain("1");
    expect(screen.getByRole("tab", { name: /Widgets/ }).textContent).toContain("0");
  });

  it("tirar uma tecla guardada", async () => {
    const user = userEvent.setup();
    useLib.setState({ open: ["Saved keys"] });
    setup();
    await user.click(screen.getByRole("button", { name: "Remove from saved keys" }));
    expect(useConfig.getState().cfg?.saved_keys).toBeUndefined();
  });
});

describe("LibraryPanel: Widgets", () => {
  it("filtro de origem com os plugins num grupo; widget de vários tamanhos abre as peças", async () => {
    const user = userEvent.setup();
    useLib.setState({ tab: "widgets", open: ["w:time"] });
    setup();
    const origin = screen.getByRole("combobox", { name: "Origin" });
    expect([...origin.querySelectorAll("optgroup option")].map((o) => o.textContent)).toEqual(["Clima (1)"]);
    const clock = screen.getByRole("button", { name: /Clock/ });
    expect(clock.getAttribute("aria-expanded")).toBe("false");
    await user.click(clock);
    expect(screen.getByRole("button", { name: "2×2" })).toBeTruthy();
    await user.selectOptions(origin, "weather");
    expect(screen.queryByRole("button", { name: /Clock/ })).toBeNull();
    expect(screen.getByText(/Only the widgets from Clima/)).toBeTruthy();
  });
});
