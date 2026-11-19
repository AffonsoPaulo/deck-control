import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { canonCombo, useValidation, useValidationState } from "@/core/validation";
import { useToast } from "@/core/toast";
import { BindField } from "@/features/keys/logic/BindField";
import { Problems } from "@/features/keys/Problems";
import { friendlyError } from "@/features/keys/validation";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/core/api", () => ({ api }));

const SCHEMA = {
  actions: {
    bind: { label: "Exclusive shortcut" },
    hotkey: { label: "Keyboard shortcut" },
  },
  plugins: [],
  field_labels: { keys: "Keys" },
};
const t = (s: string, a: unknown[] = []) =>
  s.replace(/\{(\d)\}/g, (_m, i: string) => String(a[Number(i)]));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(["schema"], SCHEMA);
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.mockReset();
  useConfig.getState().load({ pages: { p: {} } });
  useUi.setState({ page: "p", key: "1" });
  useValidationState.setState({ errors: [], conflicts: [] });
});
afterEach(cleanup);

describe("conferência", () => {
  it("canonCombo põe os modificadores na ordem do Python", () => {
    expect(canonCombo("Shift+Ctrl+F13")).toBe("ctrl+shift+f13");
    expect(canonCombo("rctrl + lctrl + a")).toBe("ctrl+a");
  });

  it("o erro do servidor vira texto da pessoa", () => {
    expect(
      friendlyError(
        t,
        SCHEMA as never,
        "pages.main.3.hold: ação 'hotkey' precisa do campo 'keys'",
      ),
    ).toBe(
      "Page {0}, key {1} (on hold): "
        .replace("{0}", "main")
        .replace("{1}", "3") + 'fill in "Keys"',
    );
  });

  it("o erro do servidor em inglês (app em inglês) também vira texto da pessoa", () => {
    const f = (e: string) => friendlyError(t, SCHEMA as never, e);
    expect(f("pages.main.3.double: action 'hotkey' needs the field 'keys'")).toBe(
      'Page main, key 3 (on double tap): fill in "Keys"',
    );
    expect(f("pages.main.4: 'page' action points to 'obs', which doesn't exist")).toBe(
      'Page main, key 4: goes to page "obs", which doesn\'t exist',
    );
    expect(f("pages.main.5: unknown action type 'xyz'. Known: hotkey, text")).toBe('Page main, key 5: unknown action "xyz"');
    expect(f("home: page 'x' doesn't exist")).toBe('The home page "x" doesn\'t exist');
    expect(f("pages.main.5: tipo de ação desconhecido 'xyz'. Conhecidos: hotkey")).toBe('Page main, key 5: unknown action "xyz"');
  });

  it("o painel mostra o que impede salvar e os atalhos repetidos; some sem nada", () => {
    const { container } = wrap(<Problems />);
    expect(container.innerHTML).toBe("");
    act(() =>
      useValidationState.setState({
        errors: ["home: página 'x' não existe"],
        conflicts: [
          {
            combo: "ctrl+f13",
            places: [
              { page: "p", key: "1", type: "bind" },
              { page: "p", key: "2", type: "hotkey" },
            ],
          },
        ],
      }),
    );
    expect(screen.getByText('The home page "x" doesn\'t exist')).toBeTruthy();
    expect(
      screen.getByText(
        /ctrl\+f13: page p, key 1 \(Exclusive shortcut\); page p, key 2 \(Keyboard shortcut\)/,
      ),
    ).toBeTruthy();
  });

  it("o atalho único avisa onde mais está o mesmo atalho (sem contar a própria tecla) e gera outro", async () => {
    const set = vi.fn();
    useValidationState.setState({
      errors: [],
      conflicts: [
        {
          combo: "ctrl+f13",
          places: [
            { page: "p", key: "1", type: "bind" },
            { page: "p", key: "2", type: "hotkey" },
          ],
        },
      ],
    });
    api.mockResolvedValue({ combos: ["ctrl+f14"] });
    wrap(<BindField step={{ type: "bind", keys: "Ctrl+F13" }} set={set} />);
    expect(
      screen.getByText(/also used in page p, key 2 \(Keyboard shortcut\)\./),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Make another" }));
    expect(api).toHaveBeenCalledWith(
      "POST /api/free_bind",
      expect.objectContaining({ count: 1, rules: null }),
    );
    expect(set).toHaveBeenCalledWith("keys", "ctrl+f14");
  });

  it("conferência que falha não apaga o resultado nem inventa um atalho repetido novo", async () => {
    useToast.setState({ current: null, leaving: false });
    const dup = { combo: "ctrl+f13", places: [] };
    function Probe() {
      useValidation();
      return null;
    }
    api.mockResolvedValueOnce({ ok: true, conflicts: [dup] });
    wrap(<Probe />);
    await waitFor(() => expect(useValidationState.getState().conflicts).toEqual([dup]));
    // falha: fica o que estava
    api.mockRejectedValueOnce(new Error("offline"));
    act(() => useConfig.getState().edit((d) => void (d.home = "p"), "x"));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(useValidationState.getState().conflicts).toEqual([dup]);
    // volta com o mesmo atalho repetido: sem aviso
    api.mockResolvedValueOnce({ ok: true, conflicts: [dup] });
    act(() => useConfig.getState().edit((d) => void (d.home = "q"), "y"));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3), { timeout: 2000 });
    expect(useToast.getState().current).toBeNull();
    // outro atalho no lugar dele (a contagem não muda): avisa
    api.mockResolvedValueOnce({ ok: true, conflicts: [{ combo: "ctrl+f14", places: [] }] });
    act(() => useConfig.getState().edit((d) => void (d.home = "r"), "z"));
    await waitFor(() => expect(useToast.getState().current?.bad).toBe(true), { timeout: 2000 });
  });
});
