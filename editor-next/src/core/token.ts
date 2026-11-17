// O token do editor vem no fim da URL (#t=...), igual ao editor atual. Nunca vai para arquivo nem para log.
export function readToken(hash: string = window.location.hash): string | null {
  const t = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  return t && t.length >= 24 ? t : null;
}
