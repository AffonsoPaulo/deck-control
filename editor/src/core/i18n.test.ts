// O t() novo tem que dar exatamente o mesmo que o do editor atual (app/editor/static/i18n.js), copiado abaixo.
import { beforeAll, describe, expect, it } from "vitest";
import ptBR from "deck-static/locales/pt-BR.json";
import { i18n, setLang, t } from "./i18n";

const DICT = ptBR as Record<string, string>;

/** O t() do editor atual, igual ao de app/editor/static/i18n.js (o oráculo). */
function oldT(dict: Record<string, string>, key: string, args?: readonly unknown[]): string {
  let s = dict[key];
  if (s === undefined) s = String(key).split("##")[0]!;
  if (args) s = s.replace(/\{(\d+)\}/g, (_m, n: string) => (args[Number(n)] == null ? "" : String(args[Number(n)])));
  return s.replace(/\{\{/g, "{").replace(/\}\}/g, "}");
}

const ARGS = ["A", 2, null, "<b>&amp;</b>", "$t(x)", "{{y}}"] as const;

describe("t() igual ao do editor atual", () => {
  beforeAll(() => setLang("pt-BR"));

  it("todas as chaves do pt-BR.json, sem e com argumentos", () => {
    const diffs: string[] = [];
    for (const key of Object.keys(DICT)) {
      for (const args of [undefined, ARGS]) {
        const a = t(key, args), b = oldT(DICT, key, args);
        if (a !== b) diffs.push(`${JSON.stringify(key)} -> ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
      }
    }
    expect(diffs.slice(0, 10)).toEqual([]);
    expect(Object.keys(DICT).length).toBeGreaterThan(500);
  });

  it("casos de borda: chave sem tradução, ##, chaves duplas, HTML e $t( ficam como estão", () => {
    const cases: [string, unknown[]?][] = [
      ["Not in the file"],
      ["Mute##2"],
      ["Key {0}, page {1}", [3, "main"]],
      ["{{opt.x}} stays {0}", ["v"]],
      ["Missing {1} arg", ["a"]],
      ["<b>bold</b> & $t(other)"],
      ["Settings##3"],
    ];
    for (const [key, args] of cases) expect(t(key, args)).toBe(oldT(DICT, key, args));
  });

  it("em inglês, sai a chave (sem o ##)", async () => {
    await setLang("en");
    for (const key of Object.keys(DICT).slice(0, 200)) expect(t(key)).toBe(oldT({}, key));
    expect(t("Settings##3")).toBe("Settings");
    await setLang("pt-BR");
    expect(i18n.language).toBe("pt-BR");
  });
});
