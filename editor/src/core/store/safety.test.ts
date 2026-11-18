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

  it("a cópia no navegador não leva as senhas; recuperar mantém as de agora", () => {
    useConfig.getState().load({ pages: { main: {} }, obs: { host: "x", password: "segredo" } });
    useConfig.getState().edit((d) => void (d.home = "main"));
    const kept = localStorage.getItem(PENDING_KEY) ?? "";
    expect(kept).not.toContain("segredo");
    expect(JSON.parse(kept).cfg.obs).toEqual({ host: "x" });
    // outro dia (a rede liga depois de carregar): o app tem a senha; o que sobrou volta com ela
    stop();
    useConfig.getState().load({ pages: { main: {} }, obs: { host: "x", password: "nova" } });
    offerPending("pt-BR");
    useToast.getState().current?.buttons[0]?.run();
    expect(useConfig.getState().cfg).toEqual({ pages: { main: {} }, obs: { host: "x", password: "nova" }, home: "main" });
  });
});

describe("duas abas", () => {
  it("a gravação manda a versão; o servidor recusou (mudou em outro lugar): para de gravar e pede recarregar", async () => {
    const { flushSave } = await import("@/core/store/autosave");
    useConfig.getState().load({ pages: { main: {} } }, "rev-1");
    const post = vi.fn().mockResolvedValueOnce({ ok: true, rev: "rev-2" }).mockResolvedValueOnce({ ok: false, conflict: true, rev: "rev-9" });
    useConfig.getState().edit((d) => void (d.home = "main"));
    expect(await flushSave(post)).toBe(true);
    expect(post).toHaveBeenLastCalledWith({ pages: { main: {} }, home: "main" }, "rev-1");
    expect(useConfig.getState().rev).toBe("rev-2");
    useConfig.getState().edit((d) => void (d.brightness = 50));
    expect(await flushSave(post)).toBe(false);
    expect(post).toHaveBeenLastCalledWith(expect.anything(), "rev-2");
    expect(useConfig.getState().conflict).toBe(true);
    expect(useToast.getState().current?.msg).toMatch(/changed somewhere else/);
    // a edição daqui fica guardada para recuperar depois de recarregar
    expect(JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}").cfg.brightness).toBe(50);
    // e não tenta gravar de novo por cima
    useConfig.getState().edit((d) => void (d.brightness = 60));
    expect(await flushSave(post)).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("fechando a aba, o salvar de última hora também leva a versão", () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    useConfig.getState().load({ pages: { main: {} } }, "rev-7");
    useConfig.getState().edit((d) => void (d.home = "x"));
    window.dispatchEvent(new Event("pagehide"));
    const body = JSON.parse((f.mock.calls[0]?.[1] as RequestInit).body as string) as { rev?: string };
    expect(body.rev).toBe("rev-7");
    f.mockRestore();
  });
});
