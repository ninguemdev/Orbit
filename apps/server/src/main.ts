import { createGameServer } from './app';
import { readServerConfig } from './config';

const config = readServerConfig();
const server = createGameServer(config);

await server.listen(config.port, config.host);
console.info(`[orbit] servidor ouvindo em ws://${config.host}:${config.port}`);
