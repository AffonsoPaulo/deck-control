import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { canonCombo, useValidationState } from "@/core/validation";
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
});
