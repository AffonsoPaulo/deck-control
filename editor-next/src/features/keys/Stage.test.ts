import { describe, expect, it } from "vitest";
import { fitTabs } from "@/features/keys/Stage";

describe("abas que cabem (o +N)", () => {
  const names = ["a", "b", "c", "d", "e"];
  const widths = [100, 100, 100, 100, 100];
  it("tudo cabe: todas", () => {
    expect(fitTabs(names, widths, 600, 60, "a")).toEqual(names);
  });
  it("não cabe: as primeiras que couberem, deixando lugar para o +N", () => {
    // 330 - 6 de borda - 62 do +N = 262: cabem 2 (102 cada)
    expect(fitTabs(names, widths, 330, 60, "a")).toEqual(["a", "b"]);
  });
  it("a aberta fica sempre à mostra (sai uma do fim para ela caber)", () => {
    expect(fitTabs(names, widths, 330, 60, "e")).toEqual(["a", "e"]);
  });
});
