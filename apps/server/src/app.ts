import { randomUUID } from 'node:crypto';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DEV_ROOM_NAME, MISSION_ROOM_NAME, PARTY_ROOM_NAME } from '@orbit/contracts';
import type { Database } from '@orbit/database';
import type { ServerConfig } from './config';
import type { IdentityService } from './modules/identity/identity-service';
import { PartyAccess } from './modules/party/party-access';
import { PartyDirectory } from './modules/party/party-directory';
import { RoomTicketStore } from './modules/party/room-tickets';
import { isOriginAllowed } from './transport/access-policy';
import { defineDevSectorRoom } from './transport/dev-sector-room';
import { createAccountApi } from './transport/http/account-routes';
import { type ClassPreferences, definePartyRoom } from './transport/party-room';
import { LoadoutService } from './modules/loadout/loadout-service';
import type { MissionLifecycle } from './modules/expedition/expedition-service';
import { MissionDirectory, MissionTicketStore } from './modules/mission/mission-directory';
import { defineMissionRoom } from './transport/mission-room';

/** Maximum size of one WebSocket message; intents are a few dozen bytes. */
const MAX_PAYLOAD_BYTES = 4 * 1024;

export interface GameServices {
  /** Account API; omitted only by tests that exercise rooms alone. */
  readonly identity?: IdentityService;
  /** Persists class choices made in parties. */
  readonly classPreferences?: ClassPreferences;
  /** Database for inventory routes. */
  readonly db?: Database;
  /** Reserves the loadouts of confirmed parties (needs the database). */
  readonly expeditions?: MissionLifecycle;
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
  // Loadout saves drop the readiness of the saver's party.
  const loadouts = services.db
    ? new LoadoutService(services.db, (accountId) => directory.preparationChanged(accountId))
    : undefined;
  // Each reserved expedition gets its own mission room, created here (never by clients).
  const { expeditions } = services;
  const creationKey = randomUUID();
  const missions = expeditions
    ? {
        tickets: new MissionTicketStore(),
        directory: new MissionDirectory(
          async (expeditionId) =>
            (await matchMaker.createRoom(MISSION_ROOM_NAME, { expeditionId, creationKey })).roomId,
        ),
      }
    : undefined;
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
                ...(loadouts ? { loadouts } : {}),
                ...(missions ? { missions } : {}),
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
      ...(loadouts ? { loadouts } : {}),
      ...(expeditions && missions ? { expeditions, missions: missions.directory } : {}),
    }),
  );
  if (expeditions && missions) {
    server.define(
      MISSION_ROOM_NAME,
      defineMissionRoom({
        creationKey,
        tickets: missions.tickets,
        expeditions,
        directory: missions.directory,
      }),
    );
  }
  return server;
}
