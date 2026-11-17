// Tira um print de cada tela do editor e guarda em reference/ (fora do git: os prints dependem da máquina e das
// fontes). Antes da troca eram os prints do editor antigo, base da comparação tela por tela; o endereço no formato
// antigo (#t=...&p=...) ainda abre a tela certa.
import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../../reference/", import.meta.url));
const FIXED = new Date("2026-11-17T14:32:00-03:00");

// nome do print -> estado na URL (o editor atual abre direto nessa tela: s, p, k, tab, set)
const SCREENS: Record<string, string> = {
  "teclas-main": "p=main",
  "teclas-tecla-o-que-faz": "p=main&k=1",
  "teclas-tecla-aparencia": "p=main&k=1&tab=look",
  "teclas-widgets": "p=widgets",
  "teclas-widget-selecionado": "p=widgets&k=1",
  "teclas-obs": "p=obs",
  luz: "s=light",
  automacoes: "s=auto",
  "config-geral": "s=settings&set=general",
  "config-aparencia": "s=settings&set=look",
  "config-integracoes": "s=settings&set=integrations",
  "config-avancado": "s=settings&set=advanced",
  "config-backup": "s=settings&set=backup",
  "config-sobre": "s=settings&set=about",
  logs: "s=logs",
};

test.describe.configure({ mode: "serial" });
mkdirSync(OUT, { recursive: true });

for (const [name, state] of Object.entries(SCREENS)) {
  test(name, async ({ page }) => {
    const url = readFileSync(OUT + ".url", "utf8").trim();
    await page.clock.install({ time: FIXED });
    // as miniaturas de Estrelas e Faíscas sorteiam posições: sequência fixa para sair igual toda vez
    await page.addInitScript(() => {
      let seed = 1;
      Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${url}&${state}`);
    await page.waitForFunction(() => document.querySelectorAll(".key").length > 0 || !!document.querySelector("main"));
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    // o logo e as prévias das teclas são imagens: espera todas carregarem
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    await page.clock.runFor(1500); // animações de entrada e prévias pendentes
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}${name}.png`, animations: "disabled", caret: "hide" });
    expect(errors, "erros na página").toEqual([]);
  });
}
