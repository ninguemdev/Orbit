import {
  type AccountErrorBody,
  type AccountErrorCode,
  AccountRoute,
  type MeResponse,
  type RecoveryCodeResponse,
} from '@orbit/contracts';

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; code: AccountErrorCode | 'network' };

/** Calls the account API on the page's own origin; the session lives in an HttpOnly cookie. */
async function request<T>(path: string, method: string, body?: unknown): Promise<ApiResult<T>> {
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
  return { ok: false, code: code ?? 'network' };
}

export const accountClient = {
  me: () => request<MeResponse>(AccountRoute.Me, 'GET'),
  signUp: (nick: string, password: string) =>
    request<MeResponse>(AccountRoute.Accounts, 'POST', { nick, password }),
  login: (nick: string, password: string) =>
    request<MeResponse>(AccountRoute.Sessions, 'POST', { nick, password }),
  logout: () => request<null>(AccountRoute.CurrentSession, 'DELETE'),
  createRecoveryCode: () => request<RecoveryCodeResponse>(AccountRoute.MyRecoveryCode, 'POST', {}),
  recover: (nick: string, code: string, newPassword: string) =>
    request<MeResponse>(AccountRoute.Recovery, 'POST', { nick, code, newPassword }),
};

/** Messages that say what to do next without revealing whether an account exists. */
export function describeAccountError(code: AccountErrorCode | 'network'): string {
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
  }
}
