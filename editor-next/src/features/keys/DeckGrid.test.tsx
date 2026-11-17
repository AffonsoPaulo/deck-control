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
    await waitFor(() => expect(api).toHaveBeenCalled());
    const [route, body] = api.mock.calls[0] as [string, { keys: unknown[] }];
    expect(route).toBe("POST /api/preview");
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
});
