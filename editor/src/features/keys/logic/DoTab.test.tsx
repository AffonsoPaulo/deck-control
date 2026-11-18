import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { useToast } from "@/core/toast";
import { logicDrop } from "@/features/keys/drop";
import { DoTab } from "@/features/keys/logic/DoTab";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/core/api", () => ({ api }));

const SCHEMA = {
  actions: {
    hotkey: { label: "Keyboard shortcut", group: "Keyboard and text", fields: [{ name: "keys", kind: "combo", required: true }] },
    media: { label: "Media", group: "Programs and system", fields: [{ name: "key", kind: "enum", required: true, options: [["vol_up", "Volume up"], ["mute", "Mute"]] }] },
    delay: { label: "Wait", group: "Other" },
    if: { label: "If… then… else", group: "Pages and logic" },
    multi: { label: "Seq" },
    bind: { label: "Exclusive shortcut", group: "Keyboard and text", fields: [{ name: "keys", kind: "bind" }] },
  },
  plugin_groups: {},
  plugins: [{ id: "obs", name: "OBS Studio", shortcut_rules: { mods: ["ctrl"] } }],
  values: [],
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
  api.mockResolvedValue({ combos: [] });
  useConfig.getState().load({ pages: { p: { "1": { icon: { text: "Shortcut" }, action: "hotkey:a" }, "2": { icon: { text: "V" }, action: { type: "media", key: "vol_up" } } } } });
  useUi.setState({ page: "p", key: "1", tab: "do" });
  useToast.setState({ current: null, leaving: false });
});
afterEach(cleanup);

const key = (k: string) => (useConfig.getState().cfg?.pages as Record<string, Record<string, Record<string, unknown>>>).p?.[k];

function Harness({ k }: { k: string }) {
  const spec = useConfig((st) => (st.cfg?.pages as Record<string, Record<string, Record<string, unknown>>>).p?.[k]);
  return spec ? <DoTab page="p" k={k} spec={spec} /> : null;
}

function setup(k: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["schema"], SCHEMA);
  qc.setQueryData(["obs"], { connected: false, scenes: [], inputs: [], sources: {} });
  qc.setQueryData(["lucide-index"], {});
  qc.setQueryData(["values"], {});
  render(
    <QueryClientProvider client={qc}>
      <Harness k={k} />
    </QueryClientProvider>,
  );
  return { unsub: () => {} };
}

describe("O que faz", () => {
  it("a frase do atalho: digitar muda a combinação (várias = lista)", () => {
    const { unsub } = setup("1");
    fireEvent.change(screen.getByRole("textbox", { name: "Shortcut" }), { target: { value: "ctrl+c, ctrl+v" } });
    expect(key("1")?.action).toEqual({ type: "hotkey", keys: ["ctrl+c", "ctrl+v"] });
    unsub();
  });

  it("adicionar passo pelo + vira sequência; o nome automático acompanha a 1ª ação", async () => {
    const user = userEvent.setup();
    const { unsub } = setup("1");
    await user.click(screen.getByRole("button", { name: 'Add step to "on press"' }));
    await user.click(await screen.findByRole("button", { name: /^Wait/ }));
    await waitFor(() => expect(key("1")?.action).toEqual({ type: "multi", actions: [{ type: "hotkey", keys: "a" }, { type: "delay", ms: 500 }] }));
    unsub();
  });

  it("arrastar um passo para cima muda a ordem; um bloco não entra nele mesmo", async () => {
    useConfig.getState().load({ pages: { p: { "1": { icon: { text: "X" }, action: ["hotkey:a", { type: "if", value: "v", then: ["hotkey:b"] }] } } } });
    const { unsub } = setup("1");
    await act(async () => {
      await logicDrop.current?.({ kind: "step", path: ["action"], index: 1, label: "If" }, 'slot|["action"]|0');
    });
    expect((key("1")?.action as Record<string, unknown[]>).actions?.[0]).toMatchObject({ type: "if" });
    await act(async () => {
      await logicDrop.current?.({ kind: "step", path: ["action"], index: 0, label: "If" }, 'slot|["action",0,"then"]|0');
    });
    expect(useToast.getState().current?.msg).toBe("A block can't go inside itself.");
    unsub();
  });

  it("repetir enquanto segura só aparece para o que dá para repetir, e sai junto com ele", async () => {
    const user = userEvent.setup();
    useUi.setState({ key: "2" });
    const { unsub } = setup("2");
    await user.click(screen.getByRole("checkbox", { name: "Repeat while held" }));
    expect(key("2")?.repeat).toBe("press");
    // trocar para "Mute" (não repete): o repeat sai
    await user.selectOptions(screen.getAllByRole("combobox")[0] as HTMLSelectElement, "1");
    expect(key("2")?.repeat).toBeUndefined();
    unsub();
  });

  it("feito para: grava o programa e o atalho novo que ele aceita, sem perder um ao gravar o outro", async () => {
    const user = userEvent.setup();
    useConfig.getState().load({ pages: { p: { "1": { icon: { text: "B" }, action: { type: "bind", keys: "ctrl+shift+alt+f13" } } } } });
    api.mockResolvedValue({ combos: ["ctrl+f15"] });
    setup("1");
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Made for" }), "obs");
    await waitFor(() => expect(key("1")?.action).toEqual({ type: "bind", keys: "ctrl+f15", for: "obs" }));
    expect(api).toHaveBeenCalledWith("POST /api/free_bind", expect.objectContaining({ rules: { mods: ["ctrl"] } }));
  });
});
