import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { IconPicker } from "@/components/IconPicker";
import type { LucideIndex } from "@/core/icons/lucide";
import { buildPopular, searchIcons } from "@/core/icons/search";

// o jsdom não mede a tela: a lista virtual vira uma lista comum
vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>({ data, itemContent }: { data: T[]; itemContent: (i: number, row: T) => ReactNode }) => (
    <div>{data.map((row, i) => <div key={i}>{itemContent(i, row)}</div>)}</div>
  ),
}));

const IDX: LucideIndex = {
  mic: [0xe001, "record sound listen radio podcast"],
  "mic-off": [0xe002, "record sound mute"],
  atom: [0xe003, "atomic nuclear physics"],
  folder: [0xe004, "directory"],
  play: [0xe005, "music audio video start run"],
  house: [0xe006, "home living"],
};
const SEGOE = { E720: "mic", E768: "play", E80F: "house" };
const tr = (s: string) => ({ Microphone: "Microfone", Play: "Tocar", Home: "Início" })[s] ?? s;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

describe("busca de ícone", () => {
  const pop = buildPopular(SEGOE, tr);

  it("os mais usados saem do Segoe, na ordem, com os extras", () => {
    expect(pop.list.slice(0, 3)).toEqual([["mic", "Microfone"], ["play", "Tocar"], ["house", "Início"]]);
    expect(pop.names["mic-off"]).toBe("Microphone muted"); // extra
  });

  it("português vira o termo em inglês como palavra inteira ('microfone' não acha 'atomic'); o resto é trecho do texto", () => {
    expect(searchIcons(IDX, pop, "microfone")).toEqual(["mic", "mic-off"]);
    expect(searchIcons(IDX, pop, "mic")).toEqual(["mic", "mic-off", "atom"]);
    expect(searchIcons(IDX, pop, "casa")).toEqual(["house"]);
    expect(searchIcons(IDX, pop, "Pásta")).toEqual(["folder"]);
  });

  it("o nome exato vem primeiro", () => {
    expect(searchIcons(IDX, pop, "tocar")[0]).toBe("play");
  });
});

describe("IconPicker", () => {
  function setup(onPick = vi.fn()) {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    qc.setQueryData(["schema"], { segoe_to_lucide: SEGOE });
    qc.setQueryData(["lucide-index"], IDX);
    render(
      <QueryClientProvider client={qc}>
        <IconPicker open onOpenChange={() => {}} onPick={onPick} />
      </QueryClientProvider>,
    );
    return onPick;
  }

  it("sem busca: mais usados e depois os outros; a busca já tem o foco", async () => {
    setup();
    const dialog = await screen.findByRole("dialog", { name: "Choose icon" });
    expect(dialog.textContent).toContain("Most used");
    expect(screen.getByRole("button", { name: "Microphone" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /folder/ })).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.getAttribute("type")).toBe("search"));
  });

  it("buscar filtra (depois da pausa de 120 ms) e escolher devolve o nome", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onPick = setup();
    const input = await screen.findByRole("searchbox");
    fireEvent.change(input, { target: { value: "pasta" } });
    act(() => vi.advanceTimersByTime(130));
    expect(screen.queryByRole("button", { name: /Microphone/ })).toBeNull();
    vi.useRealTimers();
    await userEvent.setup().click(screen.getByRole("button", { name: /folder/ }));
    expect(onPick).toHaveBeenCalledWith("folder");
  });

  it("nada achado: explica como buscar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "xyzzy" } });
    act(() => vi.advanceTimersByTime(130));
    expect(screen.getByText(/No icon with that name/)).toBeTruthy();
    vi.useRealTimers();
  });
});
