import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { LightTab } from "@/features/light/LightTab";
import { reactionColor, lightSettings, setLight } from "@/features/light/settings";

const key = () => (useConfig.getState().cfg?.pages as Record<string, Record<string, Record<string, unknown>>>).p?.["1"];

function Harness() {
  const spec = useConfig((s) => (s.cfg?.pages as Record<string, Record<string, Record<string, unknown>>>).p?.["1"]);
  return spec ? <LightTab page="p" k="1" spec={spec} /> : null;
}

beforeEach(() => {
  useConfig.getState().load({ lighting: { effect: "solid", color: "#3E63DD" }, pages: { p: { "1": { icon: { text: "A", bg: "#E5484D" } } } } });
  useUi.setState({ page: "p", key: "1", tab: "light", lightMoment: "press" });
});
afterEach(cleanup);

describe("aba Luz", () => {
  it("cada momento guarda a sua reação; Padrão tira a do momento (e o light some sem nenhuma)", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Wave" }));
    await user.click(screen.getByRole("button", { name: "Fixed" }));
    expect(key()?.light).toEqual({ press: { kind: "ripple", color: "fixed" } });
    await user.click(screen.getByRole("button", { name: /^On hold/ }));
    await user.click(screen.getByRole("button", { name: "Lit while held" }));
    expect(key()?.light).toEqual({ press: { kind: "ripple", color: "fixed" }, hold: { kind: "hold" } });
    // o resumo do momento aparece embaixo do nome
    expect(screen.getByRole("button", { name: /^On press/ }).textContent).toContain("Wave, fixed color");
    await user.click(screen.getByRole("button", { name: "Default" }));
    await user.click(screen.getByRole("button", { name: /^On press/ }));
    await user.click(screen.getByRole("button", { name: "Default" }));
    expect(key()?.light).toBeUndefined();
  });

  it("cor da reação: da tecla (escura demais vira âmbar), fixa, do efeito", () => {
    const cfg = useConfig.getState().cfg;
    const st = lightSettings(cfg, "p");
    expect(reactionColor({ color: "key" }, "1", st, cfg, "p")).toBe("#E5484D");
    expect(reactionColor({ color: "fixed", fixed: "#FFFFFF" }, "1", st, cfg, "p")).toBe("#FFFFFF");
    expect(reactionColor({ color: "effect" }, "1", st, cfg, "p")).toBe("#3E63DD");
    expect(reactionColor({ color: "effect" }, "1", { ...st, effect: "rainbow" }, cfg, "p")).toBe("#FFFFFF");
  });

  it("com cada página com a sua luz, o efeito vai para a página e o brilho fica no geral", () => {
    useConfig.getState().load({ lighting: { per_page: true, effect: "solid" }, pages: { p: {}, q: {} } });
    setLight("q", "effect", "wave");
    setLight("q", "brightness", 30);
    expect(useConfig.getState().cfg?.lighting).toEqual({ per_page: true, effect: "solid", brightness: 30, pages: { q: { effect: "wave" } } });
    expect(lightSettings(useConfig.getState().cfg, "q").effect).toBe("wave");
    expect(lightSettings(useConfig.getState().cfg, "p").effect).toBe("solid");
  });
});
