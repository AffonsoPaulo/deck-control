// O que várias partes da seção Teclas usam para ler e mexer numa tecla: as teclas da página dentro de um edit,
// o nome da tecla (o texto do ícone) e mandar uma imagem para a pasta do app.
import { api } from "@/core/api";
import { normalizeIcon } from "@/core/obj";
import type { Config } from "@/core/store/config";
import type { KeySpec, PageKeys } from "@/features/keys/model";

/** As teclas da página no rascunho de um edit (cria a página se ainda não existe). */
export const draftKeys = (d: Config, page: string): PageKeys => {
  const pages = (d.pages ??= {}) as Record<string, PageKeys>;
  return (pages[page] ??= {});
};

/** O nome da tecla: o texto do ícone, numa linha só ("" se não tem). */
export const keyText = (spec: KeySpec | undefined): string => {
  const text = normalizeIcon(spec?.icon).text;
  return typeof text === "string" ? text.replace(/\n/g, " ") : "";
};

/** Manda uma imagem (arrastada ou escolhida) para a pasta do app; devolve o caminho para o config. */
export function uploadImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    reader.onload = () => {
      api("POST /api/upload", { name: file.name, data: String(reader.result) })
        .then((r) => resolve(r.path))
        .catch(reject);
    };
    reader.readAsDataURL(file);
  });
}
