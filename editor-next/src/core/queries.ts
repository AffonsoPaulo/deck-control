// Dados do servidor com React Query. Só o estado do app e os valores ao vivo ficam se atualizando sozinhos.
// O config NÃO: ele é lido uma vez e vira o estado de edição (store/config.ts). Ler de novo por cima apagaria
// o que não foi salvo e o histórico de desfazer.
import { QueryClient, useQuery } from "@tanstack/react-query";
import { api } from "@/core/api";
import type { StatusOffline, StatusOnline } from "@/core/api-types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, refetchOnReconnect: false, retry: 1, staleTime: Infinity },
  },
});

export type Status = StatusOffline | StatusOnline;
const OFFLINE: StatusOffline = { engine: false, logs: { new_errors: 0, last: 0 }, problems: [] };

/** Estado do app (Deck, OBS, plugins), a cada 2 s como no editor atual. Sem resposta = app fechado. */
export function useStatus(): Status {
  const q = useQuery({
    queryKey: ["status"],
    queryFn: async () => {
      try {
        return await api("GET /api/status");
      } catch {
        return OFFLINE;
      }
    },
    refetchInterval: 2000,
    staleTime: 0,
  });
  return q.data ?? OFFLINE;
}

/** O config como está no arquivo, uma vez só (nunca se atualiza sozinho). */
export function useInitialConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => api("GET /api/config"), gcTime: Infinity });
}

/** Ações, campos, widgets, valores e plugins (para montar os formulários). */
export function useSchema() {
  return useQuery({ queryKey: ["schema"], queryFn: () => api("GET /api/schema") });
}

/** Cenas e fontes de áudio do OBS (para os passos novos e os campos). Lido uma vez; sem o OBS, listas vazias. */
export function useObs() {
  const q = useQuery({
    queryKey: ["obs"],
    queryFn: async () => {
      try {
        const r = await api("GET /api/obs");
        return r.connected ? r : { connected: false as const, scenes: [], inputs: [], sources: {} };
      } catch {
        return { connected: false as const, scenes: [], inputs: [], sources: {} };
      }
    },
  });
  return q.data ?? { connected: false as const, scenes: [] as string[], inputs: [] as string[], sources: {} as Record<string, string[]> };
}
