import type { AddressInfo } from 'node:net';
import type { Server } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import { DEV_ROOM_NAME, PROTOCOL_VERSION, type SectorStateView } from '@orbit/contracts';
import { createGameServer } from '../src/app';

export interface TestServer {
  readonly server: Server;
  readonly endpoint: string;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const server = createGameServer({
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: new Set(['http://localhost:5173']),
    allowMissingOrigin: true,
    cookieSecure: false,
  });
  await server.listen(0, '127.0.0.1');
  const address = server.transport.server?.address() as AddressInfo;
  return {
    server,
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () => server.gracefullyShutdown(false),
  };
}

export type SectorRoom = Room<unknown, SectorStateView>;

export async function joinDevRoom(
  endpoint: string,
  options: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<SectorRoom> {
  const client = new Client(endpoint, { headers });
  return client.joinOrCreate<SectorStateView>(DEV_ROOM_NAME, {
    protocolVersion: PROTOCOL_VERSION,
    ...options,
  });
}

export async function waitFor(
  predicate: () => boolean,
  {
    timeoutMs = 5000,
    label = 'condição',
  }: { timeoutMs?: number; label?: string | (() => string) } = {},
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > deadline) {
      // A lazy label reflects what arrived while waiting (e.g. server refusals).
      throw new Error(`Tempo esgotado aguardando ${typeof label === 'function' ? label() : label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function crewSnapshot(room: SectorRoom): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  room.state.crew.forEach((member, id) => {
    result[id] = { x: member.x, y: member.y };
  });
  return result;
}

/** Leaves a room, tolerating rooms that already left or were closed by the server. */
export async function safeLeave(room: SectorRoom): Promise<void> {
  await Promise.race([room.leave().catch(() => undefined), sleep(1000)]);
}
