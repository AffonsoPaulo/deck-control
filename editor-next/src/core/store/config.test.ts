import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError } from "@/core/api";
import { flushSave, SAVE_DELAY_MS, startAutosave } from "./autosave";
import { HISTORY_LIMIT, isDirty, MERGE_MS, useConfig, type Config } from "./config";

const BASE: Config = {
  language: "pt-BR",
  pages: { main: { "1": { icon: { text: "A" } } }, obs: { "1": { icon: { text: "B" } } }, extra: {} },
  brightness: 80,
};
const json = (v: unknown) => JSON.stringify(v);
type Pages = Record<string, Record<string, unknown>>;
const pagesOf = (c: Config | null) => c!.pages as Pages;

beforeEach(() => useConfig.getState().load(structuredClone(BASE)));

describe("desfazer e refazer", () => {
  it("desfazer a exclusão de uma página a põe de volta no lugar (mesma ordem)", () => {
    const { edit, undo, redo } = useConfig.getState();
    edit((d) => {
      delete (d.pages as Pages).obs;
    });
    expect(Object.keys(pagesOf(useConfig.getState().cfg))).toEqual(["main", "extra"]);
    undo();
    expect(json(useConfig.getState().cfg)).toBe(json(BASE)); // toEqual ignora a ordem; o JSON não
    redo();
    expect(Object.keys(pagesOf(useConfig.getState().cfg))).toEqual(["main", "extra"]);
  });

  it("edição que não muda nada não vira entrada", () => {
    useConfig.getState().edit((d) => {
      d.brightness = 80;
    });
    expect(useConfig.getState().past).toHaveLength(0);
  });

  it("um gesto (mesma tag em menos de 350 ms) vira uma entrada só; outra tag ou depois disso, outra", () => {
    vi.useFakeTimers();
    const { edit } = useConfig.getState();
    for (const b of [10, 20, 30]) {
      edit((d) => {
        d.brightness = b;
      }, "brightness");
    }
    expect(useConfig.getState().past).toHaveLength(1);
    vi.advanceTimersByTime(MERGE_MS + 1);
    edit((d) => {
      d.brightness = 40;
    }, "brightness");
    edit((d) => {
      d.language = "en";
    }, "language");
    expect(useConfig.getState().past).toHaveLength(3);
    for (let i = 0; i < 3; i++) useConfig.getState().undo();
    expect(json(useConfig.getState().cfg)).toBe(json(BASE));
    vi.useRealTimers();
  });

  it("guarda no máximo 200 versões; editar depois de desfazer apaga o refazer", () => {
    const { edit } = useConfig.getState();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      edit((d) => {
        d.brightness = i;
      });
    }
    expect(useConfig.getState().past).toHaveLength(HISTORY_LIMIT);
    useConfig.getState().undo();
    expect(useConfig.getState().future).toHaveLength(1);
    edit((d) => {
      d.brightness = -1;
    });
    expect(useConfig.getState().future).toHaveLength(0);
  });

  it("a versão anterior não é mexida pela edição (o immer copia só o que mudou)", () => {
    const before = useConfig.getState().cfg!;
    useConfig.getState().edit((d) => {
      (d.pages as Pages).main!["2"] = { icon: { text: "C" } };
    });
    const after = useConfig.getState().cfg!;
    expect(Object.keys(pagesOf(before).main!)).toEqual(["1"]);
    expect(pagesOf(after).obs).toBe(pagesOf(before).obs); // parte que não mudou: o mesmo objeto
  });
});

describe("gravação automática", () => {
  type Post = NonNullable<Parameters<typeof startAutosave>[0]>;
  let post: Mock<Post>;
  let stop: () => void;
  const setBrightness = (b: number) =>
    useConfig.getState().edit((d) => {
      d.brightness = b;
    });

  beforeEach(() => {
    vi.useFakeTimers();
    post = vi.fn<Post>(async () => ({ ok: true as const }));
    stop = startAutosave(post);
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("carregar o config não grava nada", async () => {
    useConfig.getState().load(structuredClone(BASE));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 3);
    expect(post).not.toHaveBeenCalled();
    expect(useConfig.getState().saveState).toBe("saved");
  });

  it("grava 900 ms depois da última mudança, uma vez só", async () => {
    setBrightness(1);
    expect(useConfig.getState().saveState).toBe("pending");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 100);
    setBrightness(2);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 100);
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toMatchObject({ brightness: 2 });
    expect(useConfig.getState().saveState).toBe("saved");
    expect(isDirty(useConfig.getState())).toBe(false);
  });

  it("desfazer até ficar igual ao salvo cancela a gravação", async () => {
    setBrightness(5);
    useConfig.getState().undo();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(post).not.toHaveBeenCalled();
    expect(useConfig.getState().saveState).toBe("saved");
  });

  it("config com problemas: não grava e mostra os erros", async () => {
    post.mockResolvedValueOnce({ ok: false, errors: ["pages.main.1: unknown action type 'x'"] });
    setBrightness(7);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(useConfig.getState().saveState).toBe("error");
    expect(useConfig.getState().errors).toEqual(["pages.main.1: unknown action type 'x'"]);
    expect(isDirty(useConfig.getState())).toBe(true);
  });

  it("token velho (o app reiniciou): marca para recarregar", async () => {
    post.mockRejectedValueOnce(new ApiError("token inválido", 403, "token"));
    setBrightness(8);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(useConfig.getState().saveState).toBe("error");
    expect(useConfig.getState().tokenExpired).toBe(true);
  });

  it("mudança durante a gravação: grava de novo depois", async () => {
    let release: () => void = () => {};
    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true });
        }),
    );
    setBrightness(1);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(useConfig.getState().saveState).toBe("saving");
    setBrightness(2);
    release();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]![0]).toMatchObject({ brightness: 2 });
    expect(useConfig.getState().saveState).toBe("saved");
  });

  it("flushSave grava na hora", async () => {
    setBrightness(3);
    expect(await flushSave(post)).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
