// Confere se todo ícone que o Python sabe desenhar (app/editor/static/lucide-index.json, da fonte lucide.ttf)
// existe no lucide-react do editor novo. Um nome que falte aqui apareceria na tecla e não no editor.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as lucide from "lucide-react";

const indexPath = fileURLToPath(new URL("../../app/editor/static/lucide-index.json", import.meta.url));
const names = Object.keys(JSON.parse(await readFile(indexPath, "utf8")));
const pascal = (s) => s.replace(/(^|-)([a-z0-9])/g, (_m, _d, c) => c.toUpperCase());
// nomes atuais (lucide.icons) e os antigos que o pacote ainda exporta como componente (apelidos)
const has = (n) => pascal(n) in lucide.icons || pascal(n) in lucide || `${pascal(n)}Icon` in lucide;
const missing = names.filter((n) => !has(n));
const aliases = names.filter((n) => !(pascal(n) in lucide.icons) && has(n));
console.log(`${names.length} ícones na fonte do Python; faltam ${missing.length} no lucide-react (${aliases.length} só com o nome antigo)`);
// informativo (fora da CI): os que faltam são logos de marca que o Lucide tirou; o seletor de ícones (Fase 2)
// desenha pela mesma fonte do Python (lucide.ttf), então nenhum some de verdade
if (missing.length) console.log("faltam:", missing.join(", "));
