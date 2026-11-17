import { describe, expect, it } from "vitest";
import { DEFAULT_PLACE, type Place } from "@/core/hash";
import { basePath, formatRoute, parseRoute, tokenFromPath } from "@/core/route";
import { readToken } from "@/core/token";

const T = "K7QM-2XPA-9DFT";
const B = basePath(); // "/" (o base do build)
const at = (patch: Partial<Place>): Place => ({ ...DEFAULT_PLACE, ...patch });

describe("endereço legível", () => {
  it("cada lugar vira um caminho e volta igual", () => {
    const places: [Partial<Place>, string][] = [
      [{}, `${B}${T}/teclas`],
      [{ page: "main" }, `${B}${T}/teclas/main`],
      [{ page: "main", key: "4" }, `${B}${T}/teclas/main/4`],
      [{ page: "main", key: "4", tab: "look" }, `${B}${T}/teclas/main/4/aparencia`],
      [{ page: "main", key: "4", tab: "look", lookMode: "active" }, `${B}${T}/teclas/main/4/aparencia/ativa`],
      [{ page: "main", key: "4", tab: "light", lightMoment: "hold" }, `${B}${T}/teclas/main/4/luz/segurar`],
      [{ page: "main", key: "4", tab: "light" }, `${B}${T}/teclas/main/4/luz`],
      [{ page: "main", key: "4", expanded: true }, `${B}${T}/teclas/main/4/o-que-faz/ampliado`],
      [{ page: "main", view: "active" }, `${B}${T}/teclas/main?vista=ativas`],
      [{ section: "light" }, `${B}${T}/luz`],
      [{ section: "auto" }, `${B}${T}/automacoes`],
      [{ section: "logs" }, `${B}${T}/logs`],
      [{ section: "settings" }, `${B}${T}/config`],
      [{ section: "settings", setSection: "integrations" }, `${B}${T}/config/integracoes`],
    ];
    for (const [patch, url] of places) {
      expect(formatRoute(at(patch), T)).toBe(url);
      const [path, search = ""] = url.split("?");
      expect(parseRoute(path ?? "", search ? `?${search}` : "")).toEqual(at(patch));
    }
  });

  it("nome de página com espaço, acento e barra vai codificado e volta igual", () => {
    const p = at({ page: "Jogos / São Paulo", key: "2", tab: "look" });
    const url = formatRoute(p, T);
    expect(url).toBe(`${B}${T}/teclas/Jogos%20%2F%20S%C3%A3o%20Paulo/2/aparencia`);
    expect(parseRoute(url)).toEqual(p);
  });

  it("o que não se entende fica no padrão (tecla fora de 1..15, aba e seção desconhecidas)", () => {
    expect(parseRoute(`${B}${T}/teclas/main/99/aparencia`)).toEqual(at({ page: "main" }));
    expect(parseRoute(`${B}${T}/teclas/main/4/xyz/ativa`)).toEqual(at({ page: "main", key: "4" }));
    expect(parseRoute(`${B}${T}/nada`)).toEqual(at({}));
    expect(parseRoute(`${B}${T}/config/nada`)).toEqual(at({ section: "settings" }));
    expect(parseRoute(`${B}${T}/teclas/%E0%A4%A`)).toEqual(at({ page: "%E0%A4%A" })); // %-código quebrado: fica como está
  });

  it("o token: só no formato XXXX-XXXX-XXXX (base32 de Crockford, maiúsculas)", () => {
    expect(tokenFromPath(`${B}${T}/teclas`)).toBe(T);
    expect(tokenFromPath(`${B}k7qm-2xpa-9dft/teclas`)).toBeNull();
    expect(tokenFromPath(`${B}K7QM-2XPA-9DFO/teclas`)).toBeNull(); // O não existe no alfabeto
    expect(tokenFromPath(`${B}teclas`)).toBeNull();
    expect(tokenFromPath(B)).toBeNull();
  });

  it("link no formato antigo (#t=...) ainda dá o token", () => {
    expect(readToken({ pathname: B, hash: `#t=${T}&p=main` })).toBe(T);
    expect(readToken({ pathname: `${B}${T}/teclas`, hash: "" })).toBe(T);
    expect(readToken({ pathname: B, hash: "" })).toBeNull();
  });
});

describe("sincronia do endereço", () => {
  it("com token antigo (comprido) o endereço não é reescrito", async () => {
    const { startUrlSync } = await import("@/core/store/ui");
    const long = "x".repeat(32);
    window.history.replaceState(null, "", `/#t=${long}&p=main`);
    const stop = startUrlSync();
    expect(window.location.hash).toBe(`#t=${long}&p=main`);
    stop();
  });
  it("com token novo, o link antigo vira o caminho legível", async () => {
    const { startUrlSync, useUi } = await import("@/core/store/ui");
    window.history.replaceState(null, "", `/#t=${T}&p=main&k=4&tab=look`);
    useUi.setState({ section: "keys", page: "main", key: "4", tab: "look" });
    const stop = startUrlSync();
    expect(window.location.pathname).toBe(`${B}${T}/teclas/main/4/aparencia`);
    expect(window.location.hash).toBe("");
    stop();
  });
});
