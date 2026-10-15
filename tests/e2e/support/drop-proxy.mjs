// TCP proxy placed in front of the game server during E2E tests. It forwards all
// traffic unchanged and lets a test cut the real connections of one session and
// refuse new connections for a while, simulating a short network drop.
import http from 'node:http';
import net from 'node:net';

const host = '127.0.0.1';
const listenPort = Number(process.env['PROXY_PORT'] ?? 2567);
const targetPort = Number(process.env['TARGET_PORT'] ?? 2568);
const controlPort = Number(process.env['CONTROL_PORT'] ?? 2569);

/** @type {Set<{ client: net.Socket, upstream: net.Socket, sessionId: string | null }>} */
const connections = new Set();
let refuseUntil = 0;

net
  .createServer((client) => {
    if (Date.now() < refuseUntil) {
      client.destroy();
      return;
    }
    const upstream = net.connect(targetPort, host);
    const entry = { client, upstream, sessionId: null };
    connections.add(entry);
    // The WebSocket upgrade request carries `sessionId` in its query string.
    client.once('data', (chunk) => {
      const match = /[?&]sessionId=([^&\s]+)/.exec(chunk.toString('latin1'));
      if (match) entry.sessionId = match[1] ?? null;
    });
    client.pipe(upstream).pipe(client);
    const close = () => {
      connections.delete(entry);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', close).on('close', close);
    upstream.on('error', close).on('close', close);
  })
  .listen(listenPort, host);

http
  .createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (request.method !== 'POST' || url.pathname !== '/cut') {
      response.writeHead(404).end();
      return;
    }
    const sessionId = url.searchParams.get('sessionId');
    refuseUntil = Date.now() + Number(url.searchParams.get('ms') ?? 2000);
    let cut = 0;
    for (const entry of connections) {
      if (entry.sessionId !== sessionId) continue;
      entry.client.destroy();
      entry.upstream.destroy();
      cut++;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ cut }));
  })
  .listen(controlPort, host);

console.info(`[drop-proxy] ${host}:${listenPort} -> ${targetPort}, controle em ${controlPort}`);
