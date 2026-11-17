import { describe, expect, it } from "vitest";
import { cellAt, coverMap, footprint, initialPage, previewRequest, resolveDrop, selectionAfterSwap, spanOf, swapKeys, type PageKeys } from "@/features/keys/model";

const KEYS_P: PageKeys = {
  "1": { widget: "app.clock", size: "2x2" }, // ocupa 1, 2, 6, 7
  "4": { icon: "A" },
  "11": { span: [3, 1] }, // ocupa 11, 12, 13
};

describe("grade", () => {
  it("bloco: tamanho e casas cobertas", () => {
    expect(spanOf(KEYS_P["1"])).toEqual([2, 2]);
    expect(coverMap(KEYS_P)).toEqual({ "2": ["1", 1], "6": ["1", 2], "7": ["1", 3], "12": ["11", 1], "13": ["11", 2] });
    expect(footprint("4", 2, 1)).toEqual(["4", "5"]);
    expect(footprint("5", 2, 1)).toBeNull(); // sairia da grade
  });

  it("a casa do bloco debaixo do ponto", () => {
    const rect = { left: 0, top: 0, width: 200, height: 200 };
    expect(cellAt("1", KEYS_P["1"], rect, 150, 150)).toBe("7");
    expect(cellAt("1", KEYS_P["1"], rect, 10, 190)).toBe("6");
    expect(cellAt("4", KEYS_P["4"], rect, 150, 150)).toBe("4");
  });

  it("página que abre: a da URL, a inicial, a primeira", () => {
    const cfg = { home: "b", pages: { a: {}, b: {} } };
    expect(initialPage(cfg, "a")).toBe("a");
    expect(initialPage(cfg, "sumiu")).toBe("b");
    expect(initialPage({ pages: { a: {} } }, null)).toBe("a");
    expect(initialPage({}, null)).toBeNull();
  });
});

describe("soltar", () => {
  it("tecla em outra casa: troca; em casa de bloco: troca com o canto do bloco", () => {
    expect(resolveDrop({ kind: "key", key: "4" }, "9", KEYS_P)).toEqual({ op: "swap", a: "4", b: "9" });
    expect(resolveDrop({ kind: "key", key: "4" }, "7", KEYS_P)).toEqual({ op: "swap", a: "4", b: "1" });
  });
  it("na própria casa, de tecla vazia ou de outro tipo: nada", () => {
    expect(resolveDrop({ kind: "key", key: "4" }, "4", KEYS_P)).toEqual({ op: "none" });
    expect(resolveDrop({ kind: "key", key: "9" }, "4", KEYS_P)).toEqual({ op: "none" });
    expect(resolveDrop({ kind: "new", type: "keys" }, "9", KEYS_P)).toEqual({ op: "none" });
  });
  it("trocar com vazia move; a seleção acompanha a tecla", () => {
    const k: PageKeys = { "4": { icon: "A" } };
    swapKeys(k, "4", "9");
    expect(k).toEqual({ "9": { icon: "A" } });
    expect(selectionAfterSwap("4", "4", "9")).toBe("9");
    expect(selectionAfterSwap("9", "4", "9")).toBe("4");
    expect(selectionAfterSwap("2", "4", "9")).toBe("2");
  });
});

describe("prévias", () => {
  it("uma entrada por tecla; widget leva tamanho, opções e cores", () => {
    const req = previewRequest({ pages: { p: KEYS_P } }, "p");
    expect(req.keys).toHaveLength(15);
    expect(req.keys[2]).toBeNull();
    expect(req.keys[0]).toMatchObject({ widget: "app.clock", size: "2x2", options: null, colors: null, icon: {} });
    expect(req.keys[3]).toMatchObject({ icon: { text: "A" }, active_icon: null });
  });
});
