import { describe, expect, it } from "vitest";
import { DEFAULT_PLACE, formatPlace, parsePlace } from "./hash";

const T = "x".repeat(32);

describe("URL no formato do editor atual", () => {
  it("ida e volta dos endereços que o editor atual escreve", () => {
    for (const h of [
      `#t=${T}`,
      `#t=${T}&p=main`,
      `#t=${T}&s=light`,
      `#t=${T}&s=auto`,
      `#t=${T}&s=logs`,
      `#t=${T}&s=settings`,
      `#t=${T}&s=settings&set=about`,
      `#t=${T}&p=main&k=3&tab=look&lm=active`,
      `#t=${T}&p=main&k=3&tab=light&lt=hold&x=1`,
      `#t=${T}&p=obs&v=active`,
    ]) {
      expect(formatPlace(parsePlace(h), T)).toBe(h);
    }
  });

  it("o token fica em toda troca de seção", () => {
    for (const section of ["keys", "light", "auto", "logs", "settings"] as const) {
      expect(formatPlace({ ...DEFAULT_PLACE, section }, T).startsWith(`#t=${T}`)).toBe(true);
    }
  });

  it("valores desconhecidos caem no padrão", () => {
    const p = parsePlace(`#t=${T}&s=nada&k=99&tab=x&set=y`);
    expect(p).toMatchObject({ section: "keys", key: null, tab: "do", setSection: "general" });
    expect(parsePlace(`#t=${T}&open=settings`).section).toBe("settings");
  });
});
