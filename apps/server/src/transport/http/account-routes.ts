import express, { type NextFunction, type Request, type Response } from 'express';
import {
  AccountErrorCode,
  type AccountErrorBody,
  AccountRoute,
  PartyRoute,
  type RecoveryCodeResponse,
  SESSION_COOKIE,
  updateProfileSchema,
} from '@orbit/contracts';
import { type ActiveSession, postgresError } from '@orbit/database';
import { clientAddressKey } from '../../infrastructure/client-address';
import { OverloadedError } from '../../infrastructure/semaphore';
import type { PartyAccess } from '../../modules/party/party-access';
import type {
  IdentityFailure,
  IdentityService,
  SignedIn,
} from '../../modules/identity/identity-service';
import { type AccessPolicy, isOriginAllowed } from '../access-policy';
import { type CookieOptions, clearedSessionCookie, readCookie, sessionCookie } from './cookies';

export interface AccountApiOptions {
  readonly identity: IdentityService;
  readonly access: AccessPolicy;
  readonly cookie: CookieOptions;
  /** Party room tickets; omitted by servers without parties. */
  readonly party?: PartyAccess;
  readonly now?: () => Date;
}

const STATUS: Record<string, number> = {
  [AccountErrorCode.InvalidInput]: 400,
  [AccountErrorCode.Unauthenticated]: 401,
  [AccountErrorCode.InvalidCredentials]: 401,
  [AccountErrorCode.InvalidRecovery]: 401,
  [AccountErrorCode.OriginNotAllowed]: 403,
  [AccountErrorCode.InvalidInviteCode]: 404,
  [AccountErrorCode.InviteNotFound]: 404,
  [AccountErrorCode.NickTaken]: 409,
  [AccountErrorCode.PartyFull]: 409,
  [AccountErrorCode.UnsupportedMediaType]: 415,
  [AccountErrorCode.RateLimited]: 429,
  [AccountErrorCode.Overloaded]: 503,
};

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function fail(response: Response, code: AccountErrorCode): void {
  const body: AccountErrorBody = { error: code };
  response.status(STATUS[code] ?? 400).json(body);
}

/** Express 5 forwards rejected promises to the error handler. */
type Handler = (request: Request, response: Response) => Promise<void>;

/**
 * Account HTTP API. State-changing requests must come from an allowed Origin and
 * carry JSON, which together with SameSite=Strict cookies blocks cross-site writes.
 */
export function createAccountApi(options: AccountApiOptions): express.Router {
  const { identity, access, cookie } = options;
  const now = options.now ?? (() => new Date());
  const router = express.Router();

  router.use('/api', (request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    if (UNSAFE_METHODS.has(request.method)) {
      if (!isOriginAllowed(access, request.headers.origin ?? null)) {
        return fail(response, AccountErrorCode.OriginNotAllowed);
      }
      if (request.method !== 'DELETE' && !request.is('application/json')) {
        return fail(response, AccountErrorCode.UnsupportedMediaType);
      }
    }
    next();
  });
  router.use('/api', express.json({ limit: '4kb', strict: true }));

  // request.ip honors the app's 'trust proxy' setting (TRUST_PROXY).
  const address = (request: Request) => clientAddressKey(request.ip);

  const signedIn = (response: Response, result: SignedIn | IdentityFailure, status: number) => {
    if (!result.ok) return fail(response, result.code);
    response.setHeader(
      'Set-Cookie',
      sessionCookie(result.session.token, result.session.expiresAt, now(), cookie),
    );
    response.status(status).json(result.me);
  };

  const withSession =
    (
      handler: (request: Request, response: Response, session: ActiveSession) => Promise<void>,
    ): Handler =>
    async (request, response) => {
      const session = await identity.authenticate(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      );
      if (!session) return fail(response, AccountErrorCode.Unauthenticated);
      await handler(request, response, session);
    };

  router.post(AccountRoute.Accounts, async (request, response) => {
    signedIn(response, await identity.signUp(request.body, address(request)), 201);
  });

  router.post(AccountRoute.Sessions, async (request, response) => {
    signedIn(response, await identity.login(request.body, address(request)), 200);
  });

  router.post(AccountRoute.Recovery, async (request, response) => {
    signedIn(response, await identity.recover(request.body, address(request)), 200);
  });

  router.post(
    AccountRoute.MyRecoveryCode,
    withSession(async (_request, response, session) => {
      const body: RecoveryCodeResponse = {
        code: await identity.createRecoveryCode(session.accountId),
      };
      response.status(201).json(body);
    }),
  );

  router.delete(AccountRoute.CurrentSession, async (request, response) => {
    // The cookie is cleared even when the session is already dead (expired, revoked,
    // account disabled): an HttpOnly cookie cannot be removed by the client itself.
    response.setHeader('Set-Cookie', clearedSessionCookie(cookie));
    const session = await identity.authenticate(readCookie(request.headers.cookie, SESSION_COOKIE));
    if (!session) return fail(response, AccountErrorCode.Unauthenticated);
    await identity.logout(session);
    response.status(204).end();
  });

  router.get(
    AccountRoute.Me,
    withSession(async (_request, response, session) => {
      const me = await identity.me(session.accountId);
      if (!me) return fail(response, AccountErrorCode.Unauthenticated);
      response.json(me);
    }),
  );

  router.patch(
    AccountRoute.MyProfile,
    withSession(async (request, response, session) => {
      const parsed = updateProfileSchema.safeParse(request.body);
      if (!parsed.success) return fail(response, AccountErrorCode.InvalidInput);
      const result = await identity.updateColor(session.accountId, parsed.data.colorId);
      if ('ok' in result) return fail(response, result.code);
      response.json(result);
    }),
  );

  const { party } = options;
  if (party) {
    router.post(
      PartyRoute.Tickets,
      withSession(async (request, response, session) => {
        const result = party.issue(
          request.body,
          { accountId: session.accountId, nick: session.nick },
          address(request),
        );
        if (!result.ok) return fail(response, result.code);
        response.status(201).json(result.response);
      }),
    );
  }

  router.use(
    '/api',
    (error: unknown, _request: Request, response: Response, next: NextFunction) => {
      if (response.headersSent) return next(error);
      if (error instanceof OverloadedError) return fail(response, AccountErrorCode.Overloaded);
      // Body parser errors (bad JSON, size, charset, encoding) are client errors.
      const status = (error as { status?: number }).status;
      if (status === 415) return fail(response, AccountErrorCode.UnsupportedMediaType);
      if (status !== undefined && status >= 400 && status < 500) {
        return fail(response, AccountErrorCode.InvalidInput);
      }
      // Never log the message: database errors embed query parameters (hashes, nicks).
      const name = error instanceof Error ? error.name : typeof error;
      console.error(`[api] erro inesperado: ${name} ${postgresError(error)?.code ?? ''}`);
      response.status(500).json({ error: 'internal_error' });
    },
  );
  return router;
}
