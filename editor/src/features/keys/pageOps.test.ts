import { beforeEach, describe, expect, it } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { useToast } from "@/core/toast";
import { addPage, deletePage, moveKeyToPage, renamePage, useRenaming } from "@/features/keys/pageOps";

const t = (s: string, a: unknown[] = []) => s.replace(/\{(\d)\}/g, (_m, i: string) => String(a[Number(i)]));
const cfg = () => useConfig.getState().cfg as Record<string, unknown> & { pages: Record<string, Record<string, Record<string, unknown>>> };

beforeEach(() => {
  useToast.setState({ current: null, leaving: false });
  useConfig.getState().load({
    home: "main",
    pages: {
      main: { "1": { action: "page:obs" }, "2": { action: { type: "multi", actions: [{ type: "page", page: "obs" }, "page:main"] } } },
      obs: { "1": { icon: { text: "A" } } },
    },
  });
  useUi.setState({ page: "main", key: "1" });
});

describe("páginas", () => {
  it("criar: nome livre, abre a página e o nome para editar", () => {
    addPage(t);
    addPage(t);
    expect(Object.keys(cfg().pages)).toEqual(["main", "obs", "new", "new 2"]);
    expect(useUi.getState().page).toBe("new 2");
    expect(useRenaming.getState().name).toBe("new 2");
  });

  it("renomear: mesma ordem, a inicial acompanha e os botões que levavam para ela também", () => {
    renamePage(t, "main", " casa ");
    expect(Object.keys(cfg().pages)).toEqual(["casa", "obs"]);
    expect(cfg().home).toBe("casa");
    renamePage(t, "obs", "live");
    expect(cfg().pages.casa?.["1"]?.action).toBe("page:live");
    expect(cfg().pages.casa?.["2"]?.action).toEqual({ type: "multi", actions: [{ type: "page", page: "live" }, "page:casa"] });
  });

  it("renomear para um nome que já existe (ou . e ..): avisa e não muda", () => {
    renamePage(t, "obs", "..");
    expect(Object.keys(cfg().pages)).toEqual(["main", "obs"]);
    renamePage(t, "obs", "main");
    expect(Object.keys(cfg().pages)).toEqual(["main", "obs"]);
    expect(useToast.getState().current?.bad).toBe(true);
  });

  it("apagar: a inicial passa para a primeira e dá para desfazer", () => {
    deletePage(t, "main");
    expect(Object.keys(cfg().pages)).toEqual(["obs"]);
    expect(cfg().home).toBe("obs");
    expect(useToast.getState().current?.msg).toBe('Page "main" deleted, with {1} keys.'.replace("{1}", "2"));
    useToast.getState().current?.buttons[0]?.run();
    expect(Object.keys(cfg().pages)).toEqual(["main", "obs"]);
  });

  it("levar a tecla para outra página: primeira casa livre; página cheia avisa", () => {
    moveKeyToPage(t, "main", "2", "obs");
    expect(cfg().pages.obs?.["2"]).toBeTruthy();
    expect(cfg().pages.main?.["2"]).toBeUndefined();
    const full = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [String(i + 1), {}]));
    useConfig.getState().load({ pages: { main: { "1": {} }, cheia: full } });
    moveKeyToPage(t, "main", "1", "cheia");
    expect(useToast.getState().current?.msg).toBe("Page cheia is full.");
    expect((useConfig.getState().cfg?.pages as Record<string, Record<string, unknown>>).main?.["1"]).toBeTruthy();
  });

  it("renomear corrige também as automações, as temporárias, a luz por página e a página temporária", () => {
    useConfig.getState().load({
      home: "main",
      temp_pages: ["obs"],
      lighting: { per_page: true, pages: { main: { effect: "wave" }, obs: { effect: "comet" } } },
      automations: [{ when: { type: "page", page: "obs" }, do: [{ type: "page.temp", page: "obs", seconds: 5 }, "page:obs"] }],
      pages: { main: {}, obs: {} },
    });
    renamePage(t, "obs", "live");
    const c = cfg() as Record<string, unknown>;
    expect(c.temp_pages).toEqual(["live"]);
    expect((c.lighting as { pages: Record<string, unknown> }).pages).toEqual({ main: { effect: "wave" }, live: { effect: "comet" } });
    expect(c.automations).toEqual([{ when: { type: "page", page: "live" }, do: [{ type: "page.temp", page: "live", seconds: 5 }, "page:live"] }]);
  });

  it("apagar tira a página das temporárias e da luz por página", () => {
    useConfig.getState().load({ temp_pages: ["obs"], lighting: { pages: { obs: {} } }, pages: { main: {}, obs: {} } });
    deletePage(t, "obs");
    expect(cfg().temp_pages).toBeUndefined();
    expect((cfg().lighting as { pages: object }).pages).toEqual({});
  });

  it("levar um bloco: vai para o primeiro lugar onde ele cabe inteiro", () => {
    // 1, 2 e 6 ocupadas: o bloco 2x2 não cabe em 1 nem em 2; o primeiro lugar com as 4 casas livres é o 3
    useConfig.getState().load({ pages: { main: { "1": { span: [2, 2], cells: [{}, {}, {}, {}] } }, b: { "1": {}, "2": {}, "6": {} } } });
    moveKeyToPage(t, "main", "1", "b");
    expect(Object.keys(cfg().pages.b ?? {}).sort()).toEqual(["1", "2", "3", "6"]);
    expect(cfg().pages.b?.["3"]?.span).toEqual([2, 2]);
  });
});
