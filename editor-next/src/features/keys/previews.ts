// Prévias das teclas (o servidor desenha cada tecla como no Deck, em PNG). Pede de novo 140 ms depois da última
// edição; enquanto a nova não chega, fica a anterior (sem piscar). Cada pedido guarda 15 imagens: o cache das
// antigas dura pouco.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { api } from "@/core/api";
import type { PreviewCells, PreviewRequest, PreviewSingle } from "@/core/api-types";
import { useT } from "@/core/i18n";
import { useConfig } from "@/core/store/config";
import { toast } from "@/core/toast";
import { useDebounced } from "@/core/useDebounced";
import { previewRequest } from "@/features/keys/model";

export type KeyPreview = PreviewSingle | PreviewCells | null;

export const isCells = (p: KeyPreview): p is PreviewCells => !!p && "cells" in p && Array.isArray(p.cells);

/** As prévias da página (uma por tecla, null = vazia); undefined enquanto a primeira não chega. */
export function usePagePreviews(page: string | null): KeyPreview[] | undefined {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  // o texto do pedido muda só quando a página (ou icons/device/widgets) muda, não a cada edição em outra página
  const body = useMemo(() => JSON.stringify(previewRequest(cfg, page)), [cfg, page]);
  // a espera é só para edições na mesma página: trocou de página, pede já (e nunca mostra as da outra)
  const waitedBody = useDebounced(body, 140);
  const waitedPage = useDebounced(page, 140);
  const ready = waitedPage === page ? waitedBody : body;
  const q = useQuery({
    queryKey: ["preview", page, ready],
    queryFn: () => api("POST /api/preview", JSON.parse(ready) as PreviewRequest),
    enabled: page !== null,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === page ? prev : undefined),
    staleTime: Infinity,
    gcTime: 20_000,
    retry: false,
  });
  useEffect(() => {
    if (q.error) toast(t("Error generating the preview: ") + q.error.message, { bad: true });
  }, [q.error, t]);
  return q.data?.images;
}
