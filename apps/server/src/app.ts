import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DEV_ROOM_NAME } from '@orbit/contracts';
import type { ServerConfig } from './config';
import type { IdentityService } from './modules/identity/identity-service';
import { isOriginAllowed } from './transport/access-policy';
import { defineDevSectorRoom } from './transport/dev-sector-room';
import { createAccountApi } from './transport/http/account-routes';
import { applyCorsPolicy } from './transport/http/cors-policy';

/** Maximum size of one WebSocket message; intents are a few dozen bytes. */
const MAX_PAYLOAD_BYTES = 4 * 1024;

export interface GameServices {
  /** Account API; omitted only by tests that exercise rooms alone. */
  readonly identity?: IdentityService;
}

export function createGameServer(config: ServerConfig, services: GameServices = {}): Server {
  const policy = {
    allowedOrigins: config.allowedOrigins,
    allowMissingOrigin: config.allowMissingOrigin,
  };
  applyCorsPolicy(policy);
  const { identity } = services;
  const server = new Server({
    greet: false,
    transport: new WebSocketTransport({
      maxPayload: MAX_PAYLOAD_BYTES,
      // Origin is checked on the WebSocket upgrade as well as in matchmaking (onAuth).
      beforeUpgrade: (_request, context) =>
        isOriginAllowed(policy, context.headers.get('origin'))
          ? undefined
          : new Response(null, { status: 403 }),
    }),
    ...(identity
      ? {
          express: (app) => {
            app.disable('x-powered-by');
            app.use(
              createAccountApi({
                identity,
                access: policy,
                cookie: { secure: config.cookieSecure },
              }),
            );
          },
        }
      : {}),
  });
  server.define(DEV_ROOM_NAME, defineDevSectorRoom(policy));
  return server;
}
