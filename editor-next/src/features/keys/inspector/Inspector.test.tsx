import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { useToast } from "@/core/toast";
import { Inspector } from "@/features/keys/inspector/Inspector";
import { useSession } from "@/features/keys/session";
import { useKeyShortcuts } from "@/features/keys/shortcuts";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/core/api", () => ({ api }));

const SCHEMA = {
  actions: {
    hotkey: { label: "Keyboard shortcut", group: "Keyboard and text" },
    "obs.record": { label: "Record", group: "OBS", state: true },
    multi: { label: "Seq" },
  },
  plugin_groups: {},
  plugins: [],
  values: [],
  widgets: {},
  widget_categories: [],
};

const PLACE = { section: "keys", setSection: "general", page: "main", key: null, tab: "do", lookMode: "normal", lightMoment: "press", view: "normal", expanded: false } as const;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  api.mockReset();
  api.mockImplementation((route: string) => Promise.resolve(route === "POST /api/free_bind" ? { combos: [] } : { images: [] }));
  useConfig.getState().load({
    pages: { main: { "4": { icon: { text: "Live", lucide: "radio" }, action: "hotkey:a" }, "3": { icon: { text: "Rec" }, action: "obs.record" } } },
  });
  useUi.setState({ page: "main", key: null, tab: "look", lookMode: "normal" });
  useSession.setState({ clipboard: null, sizesOpen: null, lookMem: {} });
  useToast.setState({ current: null, leaving: false });
});
afterEach(cleanup);

function Harness() {
  useKeyShortcuts("main");
  return <Inspector page="main" previews={undefined} place={PLACE} />;
}
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["schema"], SCHEMA);
  qc.setQueryData(["obs"], { connected: false, scenes: [], inputs: [], sources: {} });
  qc.setQueryData(["lucide-index"], {});
  return render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  );
}
const keys = () => (useConfig.getState().cfg?.pages as Record<string, Record<string, Record<string, unknown>>>).main ?? {};

describe("Inspector", () => {
  it("sem tecla: como montar; tecla vazia: as ações rápidas e Ver todas", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole("heading", { name: "How to set up your Deck" })).toBeTruthy();
    useUi.setState({ key: "9" });
    expect(await screen.findByRole("heading", { name: "Key 9 is empty" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keyboard shortcut" }));
    await waitFor(() => expect(keys()["9"]).toBeTruthy());
  });

  it("o nome da tecla: cada letra entra no mesmo passo do desfazer", async () => {
    const user = userEvent.setup();
    useUi.setState({ key: "4" });
    setup();
    const name = screen.getByRole("textbox", { name: "Key name" });
    await user.clear(name);
    await user.type(name, "Ao vivo");
    expect((keys()["4"]?.icon as Record<string, unknown>).text).toBe("Ao vivo");
    useConfig.getState().undo();
    expect((keys()["4"]?.icon as Record<string, unknown>).text).toBe("Live");
  });

  it("Aparência: trocar para só texto e voltar lembra o ícone", async () => {
    const user = userEvent.setup();
    useUi.setState({ key: "4" });
    setup();
    await user.click(screen.getByRole("button", { name: "Text only" }));
    expect((keys()["4"]?.icon as Record<string, unknown>).lucide).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Icon" }));
    expect((keys()["4"]?.icon as Record<string, unknown>).lucide).toBe("radio");
  });

  it("tecla com estado: escolher a aparência de ligada e o que muda nela", async () => {
    const user = userEvent.setup();
    useUi.setState({ key: "3" });
    setup();
    await user.click(screen.getByRole("button", { name: "When active" }));
    expect(useUi.getState().lookMode).toBe("active");
    fireEvent.change(screen.getByRole("textbox", { name: "Key text" }), { target: { value: "REC" } });
    expect(keys()["3"]?.active_icon).toEqual({ text: "REC" });
    fireEvent.change(screen.getByRole("textbox", { name: "Key text" }), { target: { value: "" } });
    expect(keys()["3"]?.active_icon).toBeUndefined(); // vazia: some
  });

  it("tecla sem estado não mostra a escolha de aparência", () => {
    useUi.setState({ key: "4", lookMode: "active" });
    setup();
    expect(screen.queryByRole("button", { name: "When active" })).toBeNull();
    expect(screen.getByRole("button", { name: "Text only" })).toBeTruthy(); // edita a normal
  });
});

describe("atalhos", () => {
  it("Ctrl+C / Ctrl+V copiam e colam; Delete apaga; setas andam; Esc tira a escolha", async () => {
    useUi.setState({ key: "4" });
    setup();
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    expect(useSession.getState().clipboard).toEqual(keys()["4"]);
    useUi.setState({ key: "5" });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await waitFor(() => expect(keys()["5"]).toEqual(keys()["4"]));
    fireEvent.keyDown(window, { key: "Delete" });
    expect(keys()["5"]).toBeUndefined();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(useUi.getState().key).toBe("10");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUi.getState().key).toBeNull();
  });

  it("digitando num campo, os atalhos ficam quietos", async () => {
    const user = userEvent.setup();
    useUi.setState({ key: "4" });
    setup();
    const name = screen.getByRole("textbox", { name: "Key name" });
    await user.click(name);
    fireEvent.keyDown(name, { key: "Delete" });
    expect(keys()["4"]).toBeTruthy();
  });
});
