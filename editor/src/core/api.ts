// Cliente da API do editor, tipado pelo contrato (api-types.ts, gerado de app/editor/contract.schema.json).
//   await api("GET /api/status")
//   await api("POST /api/config", { config })
// O token vai no cabeçalho X-Token (vem do fim da URL, #t=...). Erro de HTTP vira ApiError com a mensagem do
// servidor; code "token" = a aba ficou com o token velho (o app reiniciou): é preciso recarregar a página.
import type { ApiError as ApiErrorBody, ApiRoutes } from "@/core/api-types";
import { readToken } from "@/core/token";

export type Route = keyof ApiRoutes;
export type Req<R extends Route> = ApiRoutes[R]["request"];
export type Res<R extends Route> = ApiRoutes[R]["response"];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Args<R extends Route> = Req<R> extends undefined ? [] : [body: Req<R>];

let token: string | null = typeof window === "undefined" ? null : readToken();

/** Para os testes (e se um dia o token mudar sem recarregar). */
export function setToken(value: string | null): void {
  token = value;
}

export async function api<R extends Route>(route: R, ...args: Args<R>): Promise<Res<R>> {
  const space = route.indexOf(" ");
  const method = route.slice(0, space);
  let path = route.slice(space + 1);
  const body = args[0] as Record<string, unknown> | undefined;
  const init: RequestInit = { method, headers: { "X-Token": token ?? "" } };
  if (method === "GET") {
    // GET com parâmetros (só /api/logs?after=): vão na URL, como o servidor espera
    if (body && Object.keys(body).length) path += "?" + new URLSearchParams(body as Record<string, string>).toString();
  } else {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  const r = await fetch(path, init);
  let data: unknown = {};
  try {
    data = await r.json();
  } catch {
    /* sem corpo JSON */
  }
  if (!r.ok) {
    const err = data as Partial<ApiErrorBody>;
    throw new ApiError(err.error ?? `HTTP ${r.status}`, r.status, err.code);
  }
  return data as Res<R>;
}
