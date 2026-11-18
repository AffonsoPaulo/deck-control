import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { LightSection } from "@/features/light/LightSection";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/core/api", () => ({ api }));

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({ previews: [] });
  useConfig.getState().load({ home: "main", pages: { main: { "1": { icon: { text: "A" } } }, b: {} } });
  useUi.setState({ section: "light", page: "main", key: null });
});
afterEach(cleanup);

const lighting = () => useConfig.getState().cfg?.lighting as Record<string, unknown> | undefined;

describe("tela Luz", () => {
  it("ligar a luz cria o padrão; efeito e reação gravam; por página, o efeito vai para a página aberta", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LightSection />
      </QueryClientProvider>,
    );
    // desligada: os cartões ficam sem resposta (inert)
    expect(screen.getByRole("button", { name: "Comet", hidden: true }).closest("section")?.hasAttribute("inert")).toBe(true);
    await user.click(screen.getByRole("switch", { name: "Control the Deck light" }));
    expect(lighting()).toEqual({ effect: "solid", color: "#F5A524", brightness: 80, reaction: { kind: "ripple", color: "key" } });
    await user.click(screen.getByRole("button", { name: "Comet" }));
    await user.click(screen.getByRole("button", { name: "Dot" }));
    expect(lighting()).toMatchObject({ effect: "comet", reaction: { kind: "point", color: "key" } });
    await user.click(screen.getByRole("switch", { name: "Each page with its own light" }));
    await user.click(screen.getAllByRole("button", { name: "Wave" })[0] as HTMLElement);
    expect(lighting()).toMatchObject({ effect: "comet", per_page: true, pages: { main: { effect: "wave" } } });
    // desligar tira tudo
    await user.click(screen.getByRole("switch", { name: "Control the Deck light" }));
    expect(lighting()).toBeUndefined();
  });
});
