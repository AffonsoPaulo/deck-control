import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { SettingsSection } from "@/features/settings/SettingsSection";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/core/api", () => ({ api }));

const SCHEMA = {
  actions: {},
  plugin_groups: {},
  plugin_errors: [],
  values: [],
  widgets: {},
  plugins: [
    {
      id: "discord",
      name: "Discord",
      builtin: true,
      config_path: ["discord"],
      default_enabled: true,
      steps: ["Open **Settings**", { text: "Only in rpc", when: { mode: "rpc" } }],
      settings: [
        { name: "mode", kind: "enum", style: "pills", label: "How to connect", default: "keys", options: [["keys", "Shortcuts"], ["rpc", "Client ID"]] },
        { name: "client_id", kind: "text", label: "Client ID", when: { mode: "rpc" } },
      ],
    },
  ],
};

function setup(section: "general" | "integrations" | "advanced") {
  useUi.setState({ section: "settings", setSection: section, page: "main" });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["schema"], SCHEMA);
  qc.setQueryData(["obs"], { connected: false, scenes: [], inputs: [], sources: {} });
  qc.setQueryData(["about"], { firmware: null, device: false, autostart: false, config: "x", log: "y" });
  render(
    <QueryClientProvider client={qc}>
      <SettingsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({ files: { folder: "f", file: "app.log", count: 1, bytes: 2000 }, detail: { detail: false, areas: [], force: false }, records: [], problems: [] });
  useConfig.getState().load({ home: "main", pages: { main: {}, b: {} } });
});
afterEach(cleanup);
const cfg = () => useConfig.getState().cfg as Record<string, Record<string, unknown>>;

describe("Config", () => {
  it("geral: brilho em passos de 10, página inicial", async () => {
    const user = userEvent.setup();
    setup("general");
    await user.click(screen.getByRole("button", { name: "Decrease screen brightness" }));
    expect(cfg().brightness).toBe(90);
    await user.click(screen.getByRole("button", { name: "b" }));
    expect(cfg().home).toBe("b");
  });

  it("integrações: desligar guarda os dados; a escolha mostra os campos e passos que dependem dela", async () => {
    const user = userEvent.setup();
    setup("integrations");
    expect(screen.queryByText("Only in rpc")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Client ID" }));
    expect(cfg().discord).toEqual({ mode: "rpc" });
    expect(screen.getByRole("textbox", { name: "Client ID" })).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Enable Discord" }));
    expect(cfg().discord).toEqual({ mode: "rpc", enabled: false });
    // desligada: o passo a passo abre sozinho, com o passo que vale para rpc
    expect(screen.getByText("Only in rpc")).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Enable Discord" }));
    expect(cfg().discord).toEqual({ mode: "rpc" });
  });

  it("avançado: áreas do detalhado só com o detalhado, na ordem da lista", async () => {
    const user = userEvent.setup();
    setup("advanced");
    expect((screen.getByRole("checkbox", { name: /Values/ }) as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Detailed" }));
    await user.click(screen.getByRole("checkbox", { name: /Values/ }));
    await user.click(screen.getByRole("checkbox", { name: /Keys/ }));
    expect(cfg().logging).toEqual({ detail: true, areas: ["keys", "values"] });
    await user.click(screen.getByRole("switch", { name: "Show error on the key" }));
    expect(cfg().logging?.key_error).toBe(false);
  });
});
