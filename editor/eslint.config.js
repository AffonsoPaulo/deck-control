// Lint do editor novo. As regras do Tailwind garantem o design system: só classes que existem no nosso tema
// (os tokens) e nada de valor escrito direto (rounded-[7px], bg-[#123456], p-[13px]).
import js from "@eslint/js";
import betterTailwind from "eslint-plugin-better-tailwindcss";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src/core/api-types.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "better-tailwindcss": betterTailwind },
    settings: { "better-tailwindcss": { entryPoint: "src/styles/app.css" } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // as classes do desenho do aparelho (src/features/keys/deck.css) são a exceção do design system:
      // --device-* e medidas próprias; só elas ficam fora da checagem
      "better-tailwindcss/no-unknown-classes": ["error", { ignore: ["^deck(-[a-z]+)*$"] }],
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-duplicate-classes": "error",
      "better-tailwindcss/no-restricted-classes": [
        "error",
        {
          restrict: [
            {
              pattern: String.raw`\[.+\]`,
              message: "Valor escrito direto: use um token do tokens.css (ou crie um lá).",
            },
          ],
        },
      ],
    },
  },
  {
    // nos testes, "isto existe" é justamente o que se está conferindo
    files: ["**/*.test.{ts,tsx}"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["*.config.{js,ts}", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
