// O token do editor: o primeiro pedaço do caminho (/next/XXXX-XXXX-XXXX/...). Um link no formato antigo, com o
// token no fim (#t=...), ainda abre: o endereço é trocado pelo novo assim que o editor carrega. Nunca vai para
// arquivo nem para log.
import { tokenFromPath } from "@/core/route";

export function readToken(loc: Pick<Location, "pathname" | "hash"> = window.location): string | null {
  const fromPath = tokenFromPath(loc.pathname);
  if (fromPath) return fromPath;
  const legacy = new URLSearchParams(loc.hash.replace(/^#/, "")).get("t");
  return legacy || null;
}
