import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { DeckGrid } from "@/features/keys/DeckGrid";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/core/api", () => ({ api }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({
    images: Array.from({ length: 15 }, (_, i) => (i === 0 ? { normal: null, active: null, cells: ["data:a", "data:b", "data:c", "data:d"] } : i === 3 ? { normal: "data:k4", active: "data:k4on" } : null)),
  });
  useConfig.getState().load({ pages: { main: { "1": { widget: "app.clock", size: "2x2" }, "4": { icon: { text: "Mic" }, action: { type: "keys" } } } } });
  useUi.setState({ page: "main", key: null, view: "normal" });
});
afterEach(cleanup);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeckGrid page="main" />
    </QueryClientProvider>,
  );
}

describe("DeckGrid", () => {
  it("desenha as teclas: o bloco 2×2 vale por quatro casas, as vazias têm nome", async () => {
    setup();
    const keys = screen.getAllByRole("button");
    expect(keys).toHaveLength(15 - 3); // 2, 6 e 7 ficam dentro do bloco
    expect(screen.getByRole("button", { name: "Key 4: Mic" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Key 5, empty" })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('[data-key="1"] .deck-cell img')).toHaveLength(4));
    expect(document.querySelector<HTMLImageElement>('[data-key="4"] img')?.getAttribute("src")).toBe("data:k4");
  });

  it("pede as prévias da página ao servidor, uma entrada por tecla", async () => {
    setup();
    // (as ferramentas da tecla também pedem o schema)
    await waitFor(() => expect(api.mock.calls.some((c) => c[0] === "POST /api/preview")).toBe(true));
    const [, body] = api.mock.calls.find((c) => c[0] === "POST /api/preview") as [string, { keys: unknown[] }];
    expect(body.keys).toHaveLength(15);
  });

  it("clicar escolhe a tecla (vai para a URL pelo useUi) e marca só ela", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Key 4: Mic" }));
    expect(useUi.getState().key).toBe("4");
    expect(screen.getByRole("button", { name: "Key 4: Mic" }).getAttribute("aria-current")).toBe("true");
    expect(document.querySelectorAll("[data-selected]")).toHaveLength(1);
  });

  it("Ativas mostra a imagem de ligada", async () => {
    useUi.setState({ view: "active" });
    setup();
    await waitFor(() => expect(document.querySelector<HTMLImageElement>('[data-key="4"] img')?.getAttribute("src")).toBe("data:k4on"));
  });

  it("Shift+clique escolhe várias; um retângulo vira bloco com o desenho de cada uma", async () => {
    const user = userEvent.setup();
    setup();
    const keyBtn = (n: string) => document.querySelector<HTMLElement>(`[data-key="${n}"]`) as HTMLElement;
    await user.keyboard("{Shift>}");
    // (a 1 é um widget 2x2: o retângulo é 3, 4, 8, 9)
    await user.click(keyBtn("3"));
    await user.click(keyBtn("9"));
    expect(screen.getByText("Select a full rectangle of keys (no gaps).")).toBeTruthy();
    await user.click(keyBtn("4"));
    await user.click(keyBtn("8"));
    await user.keyboard("{/Shift}");
    expect(document.querySelectorAll("[data-multi]")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Join 2×2" }));
    const spec = (useConfig.getState().cfg?.pages as Record<string, Record<string, Record<string, unknown>>>).main?.["3"];
    expect(spec?.span).toEqual([2, 2]);
    expect(spec?.mode).toBe("split");
    expect((spec?.cells as unknown[]).length).toBe(4);
    // a ação da 4 (a única com ação) fica para o bloco
    expect(spec?.action).toEqual({ type: "keys" });
    expect(useUi.getState().key).toBe("3");
  });
});
