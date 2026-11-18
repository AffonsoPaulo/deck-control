// A página aberta, usada pelas telas Teclas e Luz (fora do Stage, para a tela Luz não carregar o palco).
import { useEffect } from "react";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { initialPage } from "@/features/keys/model";
/** A página aberta (a do endereço, se existir; senão a inicial), corrigindo o endereço quando ela não existe. */
export function useCurrentPage(): string | null {
  const cfg = useConfig((s) => s.cfg);
  const page = useUi((s) => s.page);
  const go = useUi((s) => s.go);
  const valid = initialPage(cfg, page);
  useEffect(() => {
    if (valid !== page) go({ page: valid, key: null });
  }, [valid, page, go]);
  return valid;
}
