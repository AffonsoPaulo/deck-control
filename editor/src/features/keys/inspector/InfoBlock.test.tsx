import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { useToast } from "@/core/toast";
import { Inspector } from "@/features/keys/inspector/Inspector";
import { useSession } from "@/features/keys/session";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/core/api", () => ({ api }));

const SCHEMA = {
  actions: { multi: { label: "Seq" } },
  plugin_groups: {},
  plugins: [],
  values: [
    { id: "clock.hour", label: "Hour", group: "Clock", kind: "number", sample: "14" },
    { id: "system.volume", label: "Volume", group: "System", kind: "number", sample: "50" },
    { id: "weather.icon", label: "Weather icon", group: "Weather", kind: "icon" },
  ],
  widgets: {},
  widget_categories: [],
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
  api.mockResolvedValue({ values: {} });
  useConfig.getState().load({
    pages: {
      p: {
        "1": { icon: { text: "{clock.hour}" } }, // informação (texto com valor)
        "6": { span: [2, 1], cells: [{ text: "Esq" }, { text: "Dir" }], icon: { text: "Bloco" } },
      },
    },
  });
  useUi.setState({ page: "p", key: null, tab: "look", lookMode: "normal" });
  useSession.setState({ clipboard: null, sizesOpen: null, lookMem: {}, ruleOpen: null, cellIdx: 0 });
  useToast.setState({ current: null, leaving: false });
});
afterEach(cleanup);

function setup(key: string) {
  useUi.setState({ key });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["schema"], SCHEMA);
  qc.setQueryData(["lucide-index"], {});
  qc.setQueryData(["values"], {});
  return render(
    <QueryClientProvider client={qc}>
      <Inspector page="p" previews={undefined} />
    </QueryClientProvider>,
  );
}
const keys = () => (useConfig.getState().cfg?.pages as Record<string, Record<string, Record<string, unknown>>>).p ?? {};

describe("tecla de informação", () => {
  it("o texto mostra o valor como etiqueta; barra, fundo por faixas e ícone de um valor", async () => {
    const user = userEvent.setup();
    setup("1");
    expect(screen.getByRole("textbox", { name: "Text" }).textContent).toBe("Hour");
    await user.click(screen.getByRole("switch", { name: "Bar at the bottom" }));
    expect((keys()["1"]?.icon as Record<string, unknown>).bar).toEqual({ value: "clock.hour", min: 0, max: 100, color: "#F5A524" });
    await user.click(screen.getByRole("button", { name: "Depending on a value" }));
    expect(((keys()["1"]?.icon as Record<string, unknown>).bg as Record<string, unknown>).bands).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "From a value" }));
    expect((keys()["1"]?.icon as Record<string, unknown>).lucide).toBe("{weather.icon}");
  });

  it("regra: adicionar abre a edição; sem regras, o campo some", async () => {
    const user = userEvent.setup();
    setup("1");
    await user.click(screen.getByRole("button", { name: "Add rule" }));
    expect(keys()["1"]?.rules).toEqual([{ if: { value: "", op: "eq", to: true }, icon: { bg: "#b4232a" } }]);
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove rule" }));
    expect(keys()["1"]?.rules).toBeUndefined();
  });
});

describe("bloco", () => {
  it("escolher a tecla do bloco edita só ela", async () => {
    const user = userEvent.setup();
    setup("6");
    await user.click(screen.getByRole("button", { name: "Key 2 of the block" }));
    await user.click(screen.getByRole("switch", { name: "Bar at the bottom" }));
    const cells = keys()["6"]?.cells as Record<string, unknown>[];
    expect(cells[0]).toEqual({ text: "Esq" });
    expect(cells[1]?.bar).toBeTruthy();
  });

  it("separar teclas: cada parte vira uma tecla; desfazer volta o bloco", async () => {
    const user = userEvent.setup();
    setup("6");
    await user.click(screen.getByRole("button", { name: "Separate keys" }));
    await waitFor(() => expect(keys()["7"]).toEqual({ icon: { text: "Dir" } }));
    expect(keys()["6"]).toEqual({ icon: { text: "Esq" } });
    useConfig.getState().undo();
    expect(keys()["6"]?.span).toEqual([2, 1]);
  });

  it("salvar como widget vai para Meus widgets com a grade do bloco", async () => {
    const user = userEvent.setup();
    setup("6");
    await user.click(screen.getByRole("button", { name: "Save as widget" }));
    const name = await screen.findByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Meu painel");
    await user.click(screen.getByRole("button", { name: "Save widget" }));
    expect(useConfig.getState().cfg?.widgets).toEqual({
      "my.meu_painel": { label: "Meu painel", icon: "layout-grid", sizes: { "1x2": [[{ text: "Esq" }, { text: "Dir" }]] } },
    });
  });
});
