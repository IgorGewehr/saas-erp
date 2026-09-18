/**
 * lib/services/vitrine/apiClient.ts
 *
 * Cliente HTTP mínimo da Vitrine (browser): manda o token do usuário, devolve um
 * resultado tipado em vez de lançar — o fluxo de fechar negócio precisa do STATUS e do
 * `code` da resposta pra decidir se dá pra tentar de novo, e uma exceção com só a
 * mensagem perderia isso. `fetch`/token injetáveis pra teste.
 */

export type ApiResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string; code?: string };

export interface ApiRequestInit {
  method: 'POST' | 'PATCH';
  body: unknown;
}

export type ApiRequest = (path: string, init: ApiRequestInit) => Promise<ApiResult>;

export function createApiRequest(
  getToken: () => Promise<string>,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): ApiRequest {
  return async (path, init) => {
    let token: string;
    try {
      token = await getToken();
    } catch {
      return { ok: false, status: 401, error: 'Sessão expirada. Entre novamente.' };
    }

    let response: Response;
    try {
      response = await fetchImpl(path, {
        method: init.method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(init.body),
      });
    } catch {
      // status 0 = nem chegou no servidor (offline, túnel caiu) — a chamada pode ser repetida.
      return { ok: false, status: 0, error: 'Sem conexão com o servidor. Verifique a internet e tente de novo.' };
    }

    const payload = await response.json().catch(() => null) as
      | { ok?: boolean; data?: unknown; error?: unknown; code?: unknown }
      | null;

    if (response.ok && payload?.ok) return { ok: true, data: payload.data };
    return {
      ok: false,
      status: response.status,
      error: typeof payload?.error === 'string' ? payload.error : 'Erro na requisição.',
      ...(typeof payload?.code === 'string' ? { code: payload.code } : {}),
    };
  };
}
