import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DEV_ROOM_NAME, PARTY_ROOM_NAME } from '@orbit/contracts';
import type { Database } from '@orbit/database';
import type { ServerConfig } from './config';
import type { IdentityService } from './modules/identity/identity-service';
import { PartyAccess } from './modules/party/party-access';
import { PartyDirectory } from './modules/party/party-directory';
import { RoomTicketStore } from './modules/party/room-tickets';
import { isOriginAllowed } from './transport/access-policy';
import { defineDevSectorRoom } from './transport/dev-sector-room';
import { createAccountApi } from './transport/http/account-routes';
import { type ClassPreferences, type LoadoutReader, definePartyRoom } from './transport/party-room';

/** Maximum size of one WebSocket message; intents are a few dozen bytes. */
const MAX_PAYLOAD_BYTES = 4 * 1024;

export interface GameServices {
  /** Account API; omitted only by tests that exercise rooms alone. */
  readonly identity?: IdentityService;
  /** Persists class choices made in parties. */
  readonly classPreferences?: ClassPreferences;
  /** Saved loadouts, checked when members get ready and when the leader confirms. */
  readonly loadouts?: LoadoutReader;
  /** Database for inventory routes. */
  readonly db?: Database;
  /** Invite code attempts allowed per address (PARTY_CODE_GUESSES_PER_ADDRESS). */
  readonly codeGuessesPerAddress?: number;
}

export function createGameServer(config: ServerConfig, services: GameServices = {}): Server {
  const policy = {
    allowedOrigins: config.allowedOrigins,
    allowMissingOrigin: config.allowMissingOrigin,
  };
  const { identity } = services;
  const tickets = new RoomTicketStore();
  const directory = new PartyDirectory();
  const party = new PartyAccess({
    tickets,
    directory,
    ...(services.codeGuessesPerAddress !== undefined
      ? { codeGuessesPerAddress: services.codeGuessesPerAddress }
      : {}),
  });
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
            app.set('trust proxy', config.trustProxy);
            app.use(
              createAccountApi({
                identity,
                party,
                ...(services.db ? { db: services.db } : {}),
                onLoadoutChanged: (accountId) => directory.preparationChanged(accountId),
                access: policy,
                cookie: { secure: config.cookieSecure },
              }),
            );
          },
        }
      : {}),
  });
  // Idle HTTP connections outlive reverse-proxy keep-alive (Node's default is 5 s),
  // so a proxy never reuses a socket the server is closing.
  const http = server.transport.server;
  if (http) {
    http.keepAliveTimeout = 75_000;
    http.headersTimeout = 76_000;
  }
  server.define(DEV_ROOM_NAME, defineDevSectorRoom(policy));
  server.define(
    PARTY_ROOM_NAME,
    definePartyRoom({
      tickets,
      directory,
      ...(services.classPreferences ? { classPreferences: services.classPreferences } : {}),
      ...(services.loadouts ? { loadouts: services.loadouts } : {}),
    }),
  );
  return server;
}
