import {
  type AccountErrorBody,
  type InventoryResponse,
  AccountErrorCode,
  AccountRoute,
  type MeResponse,
  type RecoveryCodeResponse,
} from '@orbit/contracts';

/** `network`: no answer; `unexpected`: an answer outside the API contract (e.g. 500). */
export type ClientErrorCode = AccountErrorCode | 'network' | 'unexpected';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ClientErrorCode };

const KNOWN_CODES = new Set<string>(Object.values(AccountErrorCode));

/** Calls the account API on the page's own origin; the session lives in an HttpOnly cookie. */
export async function requestJson<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, code: 'network' };
  }
  if (response.status === 204) return { ok: true, data: null as T };
  const payload = (await response.json().catch(() => null)) as T | AccountErrorBody | null;
  if (response.ok && payload !== null) return { ok: true, data: payload as T };
  const code = (payload as AccountErrorBody | null)?.error;
  return { ok: false, code: code && KNOWN_CODES.has(code) ? code : 'unexpected' };
}

/**
 * Retries an idempotent read after a transient failure (no answer, or a proxy error
 * outside the API contract). Writes are never retried automatically.
 */
async function withRetry<T>(read: () => Promise<ApiResult<T>>, retries = 2): Promise<ApiResult<T>> {
  for (let attempt = 0; ; attempt++) {
    const result = await read();
    const transient = !result.ok && (result.code === 'network' || result.code === 'unexpected');
    if (!transient || attempt >= retries) return result;
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
}

export const accountClient = {
  me: () => withRetry(() => requestJson<MeResponse>(AccountRoute.Me, 'GET')),
  inventory: () => withRetry(() => requestJson<InventoryResponse>(AccountRoute.MyInventory, 'GET')),
  signUp: (nick: string, password: string) =>
    requestJson<MeResponse>(AccountRoute.Accounts, 'POST', { nick, password }),
  login: (nick: string, password: string) =>
    requestJson<MeResponse>(AccountRoute.Sessions, 'POST', { nick, password }),
  logout: () => requestJson<null>(AccountRoute.CurrentSession, 'DELETE'),
  createRecoveryCode: () =>
    requestJson<RecoveryCodeResponse>(AccountRoute.MyRecoveryCode, 'POST', {}),
  recover: (nick: string, code: string, newPassword: string) =>
    requestJson<MeResponse>(AccountRoute.Recovery, 'POST', { nick, code, newPassword }),
};

/** Messages that say what to do next without revealing whether an account exists. */
export function describeAccountError(code: ClientErrorCode): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Nick ou senha incorretos.';
    case 'nick_taken':
      return 'Esse nick já está em uso. Escolha outro.';
    case 'invalid_input':
      return 'Confira os campos: nick com 3 a 20 letras, números ou _, e senha com 12 a 128 caracteres.';
    case 'invalid_recovery':
      return 'Nick ou código de recuperação inválidos. Cada código funciona uma única vez.';
    case 'rate_limited':
      return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    case 'overloaded':
      return 'O servidor está ocupado. Tente de novo em instantes.';
    case 'unauthenticated':
      return 'Sua sessão terminou. Entre de novo.';
    case 'origin_not_allowed':
    case 'unsupported_media_type':
      return 'O navegador enviou um pedido que o servidor recusou. Recarregue a página.';
    case 'network':
      return 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.';
    case 'unexpected':
      return 'O servidor encontrou um erro. Tente de novo em instantes.';
    case 'invalid_invite_code':
      return 'Código de party não encontrado. Confira as letras e números.';
    case 'invite_not_found':
      return 'Esse convite expirou ou já foi usado.';
    case 'party_full':
      return 'A party já está completa.';
    case 'empty_slot':
      return 'Esse espaço do stash está vazio.';
    case 'invalid_slot':
      return 'Espaço do stash inválido.';
    case 'removed_from_party':
      return 'O líder removeu você desta party. Para voltar, peça um novo convite.';
  }
}
