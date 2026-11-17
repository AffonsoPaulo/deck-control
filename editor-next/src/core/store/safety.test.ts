import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "@/core/store/config";
import { PENDING_KEY, offerPending, startSafety } from "@/core/store/safety";
import { useToast } from "@/core/toast";

let stop: () => void = () => {};
beforeEach(() => {
  localStorage.clear();
  useToast.setState({ current: null, leaving: false });
  useConfig.getState().load({ pages: { main: {} } });
  stop = startSafety();
});
afterEach(() => stop());

describe("rede de segurança", () => {
  it("guarda o que não foi salvo e apaga quando salva (nunca na chave do editor atual)", () => {
    useConfig.getState().edit((d) => void (d.home = "main"));
    expect(JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}").cfg).toEqual({ pages: { main: {} }, home: "main" });
    expect(localStorage.getItem("d6-pendente")).toBeNull();
    useConfig.setState({ saved: JSON.stringify(useConfig.getState().cfg) });
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("ao abrir, oferece recuperar o que sobrou; recuperar entra como edição (dá para desfazer)", () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ cfg: { pages: { main: {}, b: {} } }, t: Date.now() }));
    offerPending("pt-BR");
    const cur = useToast.getState().current;
    expect(cur?.msg).toMatch(/were not saved/);
    cur?.buttons[0]?.run();
    expect(useConfig.getState().cfg).toEqual({ pages: { main: {}, b: {} } });
    useConfig.getState().undo();
    expect(useConfig.getState().cfg).toEqual({ pages: { main: {} } });
  });

  it("sobrou igual ao salvo: só limpa", () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ cfg: { pages: { main: {} } }, t: 1 }));
    offerPending("pt-BR");
    expect(useToast.getState().current).toBeNull();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("o app reiniciou: pede recarregar, uma vez", () => {
    useConfig.setState({ saveState: "error", tokenExpired: true, errors: [] });
    expect(useToast.getState().current?.msg).toMatch(/restarted/);
    expect(useToast.getState().current?.sticky).toBe(true);
    useToast.setState({ current: null });
    useConfig.setState({ saveState: "pending" });
    useConfig.setState({ saveState: "error" });
    expect(useToast.getState().current).toBeNull();
  });

  it("fechando a aba com algo pendente, manda salvar com keepalive", () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    useConfig.getState().edit((d) => void (d.home = "x"));
    window.dispatchEvent(new Event("pagehide"));
    expect(f).toHaveBeenCalledWith("/api/config", expect.objectContaining({ method: "POST", keepalive: true }));
    f.mockRestore();
  });
});
