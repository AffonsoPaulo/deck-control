// Tipos da API a partir do contrato do Python (app/editor/contract.schema.json).
//   npm run gen:api     regrava src/core/api-types.ts
//   npm run check:api   só confere se o arquivo está em dia (falha se não estiver)
// O arquivo gerado vai para o git: o build não precisa do Python.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const schemaPath = fileURLToPath(new URL("../../app/editor/contract.schema.json", import.meta.url));
const outPath = fileURLToPath(new URL("../src/core/api-types.ts", import.meta.url));

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const routes = schema["x-routes"];
delete schema["x-routes"];
delete schema["x-error"];

let ts = await compile(schema, "DeckEditorApi", {
  bannerComment:
    "// Gerado por scripts/gen-api.mjs a partir de app/editor/contract.schema.json. Não edite à mão:\n" +
    "// mude app/editor/contract.py, rode `python -m app.editor.contract` e depois `npm run gen:api`.",
  unreachableDefinitions: true,
  additionalProperties: false,
  format: true,
  style: { semi: true, singleQuote: false, printWidth: 120, trailingComma: "all" },
});

// a tabela de rotas: o tipo do pedido e o da resposta de cada uma
const refName = (s) => (s && s.$ref ? s.$ref.split("/").pop() : null);
const typeOf = (s) => {
  if (s == null) return "undefined";
  if (s.$ref) return refName(s);
  if (s.anyOf) return s.anyOf.map(typeOf).join(" | ");
  throw new Error("rota com tipo que não é $ref nem anyOf: " + JSON.stringify(s));
};
ts += "\n/** Pedido e resposta de cada rota (\"MÉTODO /caminho\"). */\nexport interface ApiRoutes {\n";
for (const [route, { request, response }] of Object.entries(routes)) {
  ts += `  ${JSON.stringify(route)}: { request: ${typeOf(request)}; response: ${typeOf(response)} };\n`;
}
ts += "}\n\n/** Corpo das respostas que não são 200. */\nexport type ApiError = ErrorResponse;\n";
ts = ts.replace(/\r\n/g, "\n");

if (process.argv.includes("--check")) {
  const now = (await readFile(outPath, "utf8").catch(() => "")).replace(/\r\n/g, "\n");
  if (now !== ts) {
    console.error("src/core/api-types.ts está velho: rode npm run gen:api");
    process.exit(1);
  }
  console.log("api-types.ts em dia");
} else {
  await writeFile(outPath, ts, "utf8");
  console.log(`src/core/api-types.ts (${Object.keys(routes).length} rotas)`);
}
