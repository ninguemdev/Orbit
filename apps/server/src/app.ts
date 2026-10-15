import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DEV_ROOM_NAME } from '@orbit/contracts';
import type { ServerConfig } from './config';
import { isOriginAllowed } from './transport/access-policy';
import { defineDevSectorRoom } from './transport/dev-sector-room';

/** Maximum size of one WebSocket message; intents are a few dozen bytes. */
const MAX_PAYLOAD_BYTES = 4 * 1024;

export function createGameServer(config: ServerConfig): Server {
  const policy = {
    allowedOrigins: config.allowedOrigins,
    allowMissingOrigin: config.allowMissingOrigin,
  };
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
  });
  server.define(DEV_ROOM_NAME, defineDevSectorRoom(policy));
  return server;
}
