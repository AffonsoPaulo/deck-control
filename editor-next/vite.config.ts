// O editor. Em produção o Python serve o dist/ na raiz (/XXXX-XXXX-XXXX/teclas/...), com a mesma API.
// Em desenvolvimento (npm run dev), a /api vai para o servidor de teste na porta 8799, nunca para o app real.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));
const staticDir = fileURLToPath(new URL("../app/editor/static", import.meta.url));
const tokens = `${staticDir}/tokens.css`;

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": src,
      // a fonte única dos tokens (app/editor/static/tokens.css)
      "deck-tokens.css": tokens,
      // fontes, favicon, índice do Lucide e traduções: uma cópia só, a de app/editor/static (o Python também usa)
      "deck-static": staticDir,
    },
  },
  server: {
    host: "127.0.0.1", // só esta máquina, como o servidor do editor
    port: 5173,
    strictPort: true,
    proxy: {
      // changeOrigin troca o Host para 127.0.0.1:8799, que é o que o servidor confere
      "/api": { target: "http://127.0.0.1:8799", changeOrigin: true },
    },
    fs: { allow: [".", "../app/editor/static"] },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
});
