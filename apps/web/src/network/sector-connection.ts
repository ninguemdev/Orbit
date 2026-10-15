import { Client, type Room } from '@colyseus/sdk';
import {
  ClientMessage,
  DEV_ROOM_NAME,
  INPUT_SEND_RATE_HZ,
  INTERPOLATION_DELAY_MS,
  PROTOCOL_VERSION,
  type CrewInput,
  type SectorStateView,
} from '@orbit/contracts';
import { SnapshotBuffer } from './snapshot-buffer';
import { type WorldSnapshot, snapshotFromState } from './world-snapshot';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

/** Direction the player wants to move, already in ship-local axes (length ≤ 1). */
export interface MoveIntent {
  readonly x: number;
  readonly y: number;
}

/** What the Phaser scene and the HUD may read or ask; they never touch the SDK. */
export interface SectorBridge {
  readonly sessionId: string;
  readonly status: ConnectionStatus;
  readonly pingMs: number | null;
  /** Interpolated state to render at local time `nowMs`. */
  sample(nowMs: number): WorldSnapshot | null;
  latest(): WorldSnapshot | null;
  /** Continuous movement intent; sent at the input rate, never as a position. */
  setMoveIntent(intent: MoveIntent): void;
}

export function defaultServerEndpoint(): string {
  const configured = import.meta.env['VITE_SERVER_URL'] as string | undefined;
  return configured ?? `${window.location.protocol}//${window.location.hostname}:2567`;
}

const PING_INTERVAL_MS = 2000;
const NEUTRAL: MoveIntent = Object.freeze({ x: 0, y: 0 });

export class SectorConnection implements SectorBridge {
  readonly #room: Room<unknown, SectorStateView>;
  readonly #snapshots = new SnapshotBuffer();
  #status: ConnectionStatus = 'connected';
  #pingMs: number | null = null;
  #intent: MoveIntent = NEUTRAL;
  #neutralSent = true;
  #seq = 0;
  readonly #timers: ReturnType<typeof setInterval>[];
  readonly #statusListeners = new Set<(status: ConnectionStatus) => void>();

  private constructor(room: Room<unknown, SectorStateView>) {
    this.#room = room;
    room.onStateChange((state) => this.#record(state));
    room.onDrop(() => this.#setStatus('reconnecting'));
    room.onReconnect(() => this.#setStatus('connected'));
    room.onLeave(() => this.#setStatus('disconnected'));
    this.#timers = [
      setInterval(() => room.ping((ms) => (this.#pingMs = ms)), PING_INTERVAL_MS),
      setInterval(() => this.#flushInput(), 1000 / INPUT_SEND_RATE_HZ),
    ];
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
    return this.#snapshots.latest();
  }

  sample(nowMs: number): WorldSnapshot | null {
    return this.#snapshots.sample(nowMs - INTERPOLATION_DELAY_MS);
  }

  setMoveIntent(intent: MoveIntent): void {
    this.#intent = intent;
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  async leave(): Promise<void> {
    for (const timer of this.#timers) clearInterval(timer);
    await this.#room.leave(true);
  }

  /**
   * Sends the current intent at most INPUT_SEND_RATE_HZ times per second. Idle
   * players send a single neutral input and then stay silent.
   */
  #flushInput(): void {
    if (this.#status !== 'connected') return;
    const { x, y } = this.#intent;
    const idle = x === 0 && y === 0;
    if (idle && this.#neutralSent) return;
    const input: CrewInput = { seq: this.#seq++, x, y };
    this.#room.send(ClientMessage.CrewInput, input);
    this.#neutralSent = idle;
  }

  #record(state: SectorStateView): void {
    if (!state.ship || !state.crew) return;
    this.#snapshots.push(snapshotFromState(state, performance.now()));
  }

  #setStatus(status: ConnectionStatus): void {
    this.#status = status;
    if (status !== 'connected') this.#intent = NEUTRAL;
    for (const listener of this.#statusListeners) listener(status);
  }
}
