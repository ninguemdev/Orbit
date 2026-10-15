import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { readServerConfig } from './config';

const config = readServerConfig();
const server = new Server({
  transport: new WebSocketTransport(),
  greet: false,
});

await server.listen(config.port, config.host);
console.info(`[orbit] servidor ouvindo em ws://${config.host}:${config.port}`);
