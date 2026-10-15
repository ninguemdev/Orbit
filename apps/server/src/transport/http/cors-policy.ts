import { matchMaker } from '@colyseus/core';
import { type AccessPolicy, isOriginAllowed } from '../access-policy';

/**
 * Colyseus answers every HTTP request (matchmaking and our /api routes) through a
 * listener that by default reflects any Origin with credentials allowed. Replace it
 * so only allow-listed origins may read responses or send credentialed requests.
 *
 * This configures the process-wide matchmaker, so it is called once at startup
 * (main) with the process's single access policy.
 */
export function configureProcessCors(policy: AccessPolicy): void {
  const { controller } = matchMaker;
  controller.DEFAULT_CORS_HEADERS = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  } as unknown as typeof controller.DEFAULT_CORS_HEADERS;
  controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get('origin');
    return (
      origin && isOriginAllowed(policy, origin)
        ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }
        : {}
    ) as ReturnType<typeof controller.getCorsHeaders>;
  };
}
