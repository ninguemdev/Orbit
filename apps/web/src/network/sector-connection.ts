import { Client, type Room } from '@colyseus/sdk';
import { DEV_ROOM_NAME, PROTOCOL_VERSION, type SectorStateView } from '@orbit/contracts';
import { type WorldSnapshot, snapshotFromState } from './world-snapshot';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

/** What the Phaser scene and the HUD may read or ask; they never touch the SDK. */
export interface SectorBridge {
  readonly sessionId: string;
  readonly status: ConnectionStatus;
  readonly pingMs: number | null;
  /** State to render at local time `nowMs`. */
  sample(nowMs: number): WorldSnapshot | null;
  latest(): WorldSnapshot | null;
}

export function defaultServerEndpoint(): string {
  const configured = import.meta.env['VITE_SERVER_URL'] as string | undefined;
  return configured ?? `${window.location.protocol}//${window.location.hostname}:2567`;
}

const PING_INTERVAL_MS = 2000;

export class SectorConnection implements SectorBridge {
  readonly #room: Room<unknown, SectorStateView>;
  #latest: WorldSnapshot | null = null;
  #status: ConnectionStatus = 'connected';
  #pingMs: number | null = null;
  readonly #pingTimer: ReturnType<typeof setInterval>;
  readonly #statusListeners = new Set<(status: ConnectionStatus) => void>();

  private constructor(room: Room<unknown, SectorStateView>) {
    this.#room = room;
    room.onStateChange((state) => this.record(state));
    room.onDrop(() => this.#setStatus('reconnecting'));
    room.onReconnect(() => this.#setStatus('connected'));
    room.onLeave(() => this.#setStatus('disconnected'));
    this.#pingTimer = setInterval(() => room.ping((ms) => (this.#pingMs = ms)), PING_INTERVAL_MS);
  }

  static async join(endpoint: string, name?: string): Promise<SectorConnection> {
    const client = new Client(endpoint);
    const options = name
      ? { protocolVersion: PROTOCOL_VERSION, name }
      : { protocolVersion: PROTOCOL_VERSION };
    const room = await client.joinOrCreate<SectorStateView>(DEV_ROOM_NAME, options);
    return new SectorConnection(room);
  }

  get sessionId(): string {
    return this.#room.sessionId;
  }

  get roomId(): string {
    return this.#room.roomId;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  get pingMs(): number | null {
    return this.#pingMs;
  }

  latest(): WorldSnapshot | null {
    return this.#latest;
  }

  sample(_nowMs: number): WorldSnapshot | null {
    return this.#latest;
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  async leave(): Promise<void> {
    clearInterval(this.#pingTimer);
    await this.#room.leave(true);
  }

  protected record(state: SectorStateView): void {
    if (!state.ship || !state.crew) return;
    this.#latest = snapshotFromState(state, performance.now());
  }

  #setStatus(status: ConnectionStatus): void {
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }
}
