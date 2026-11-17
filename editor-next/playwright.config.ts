// Prints de referência do editor ATUAL (npm run ref:capture), para comparar com o editor novo antes da troca.
// O servidor é o tests/reference/serve.py: config fixo, pasta de dados temporária, relógio parado.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  webServer: {
    command: "python tests/reference/serve.py",
    url: "http://127.0.0.1:8797/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
