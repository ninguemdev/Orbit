import { Client, type Room } from '@colyseus/sdk';
import {
  type ActionRejectedPayload,
  ClientMessage,
  DEV_ROOM_NAME,
  INPUT_SEND_RATE_HZ,
  INTERPOLATION_DELAY_MS,
  RoomPhase,
  type MissionInventoryView,
  type MissionOutcomePayload,
  type MissionTicketResponse,
  PROTOCOL_VERSION,
  ServerMessage,
  type CrewInput,
  type InventoryTransfer,
  type SectorStateView,
  type ShipInput,
} from '@orbit/contracts';
import { SnapshotBuffer } from './snapshot-buffer';
import {
  type SectorLayout,
  type WorldSnapshot,
  layoutFromState,
  snapshotFromState,
} from './world-snapshot';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

/** Direction the player wants to move, already in ship-local axes (length ≤ 1). */
export interface MoveIntent {
  readonly x: number;
  readonly y: number;
}

/** Helm controls: thrust and turn in [-1, 1]. */
export interface HelmIntent {
  readonly thrust: number;
  readonly turn: number;
}

export interface Notice {
  readonly code: string;
  readonly at: number;
}

/** What the Phaser scene and the HUD may read or ask; they never touch the SDK. */
export interface SectorBridge {
  readonly sessionId: string;
  readonly status: ConnectionStatus;
  readonly pingMs: number | null;
  /** Interpolated state to render at local time `nowMs`. */
  sample(nowMs: number): WorldSnapshot | null;
  latest(): WorldSnapshot | null;
  /** Static sector geometry; null until the first state arrives. */
  layout(): SectorLayout | null;
  /** Continuous movement intent; sent at the input rate, never as a position. */
  setMoveIntent(intent: MoveIntent): void;
  /** Continuous helm intent; only used while this player is the operator. */
  setHelmIntent(intent: HelmIntent): void;
  /** Requests the helm, or releases it when already the operator. */
  toggleHelm(): void;
  releaseHelm(): void;
  /** Items this player can see in a mission; null outside missions. */
  inventory(): MissionInventoryView | null;
  /** Asks the server to move a stack; the server checks position, owner and room. */
  transfer(request: InventoryTransfer): void;
  /** Calls `listener` with every inventory view the server sends; returns the unsubscribe. */
  onInventory(listener: (view: MissionInventoryView) => void): () => void;
  /** Asks the server to start the evacuation countdown; only the helm operator can. */
  requestExtraction(): void;
  /** Calls `listener` once, right before the room closes with how the match ended. */
  onMissionOutcome(listener: (outcome: MissionOutcomePayload) => void): () => void;
  /** Last refusal received from the server, for the HUD. */
  readonly lastNotice: Notice | null;
}

export function defaultServerEndpoint(): string {
  const configured = import.meta.env['VITE_SERVER_URL'] as string | undefined;
  return configured || `${window.location.protocol}//${window.location.hostname}:2567`;
}

const PING_INTERVAL_MS = 2000;
const NEUTRAL: MoveIntent = Object.freeze({ x: 0, y: 0 });
const NEUTRAL_HELM: HelmIntent = Object.freeze({ thrust: 0, turn: 0 });

export class SectorConnection implements SectorBridge {
  readonly #room: Room<unknown, SectorStateView>;
  readonly #snapshots = new SnapshotBuffer();
  #status: ConnectionStatus = 'connected';
  #pingMs: number | null = null;
  #intent: MoveIntent = NEUTRAL;
  #helmIntent: HelmIntent = NEUTRAL_HELM;
  #neutralSent = true;
  #helmNeutralSent = true;
  #seq = 0;
  #helmSeq = 0;
  #lastNotice: Notice | null = null;
  #layout: SectorLayout | null = null;
  #inventory: MissionInventoryView | null = null;
  #closeCode: number | null = null;
  readonly #timers: ReturnType<typeof setInterval>[];
  readonly #statusListeners = new Set<(status: ConnectionStatus) => void>();
  readonly #inventoryListeners = new Set<(view: MissionInventoryView) => void>();
  readonly #missionOutcomeListeners = new Set<(outcome: MissionOutcomePayload) => void>();

  private constructor(room: Room<unknown, SectorStateView>) {
    this.#room = room;
    room.onStateChange((state) => this.#record(state));
    room.onDrop(() => {
      // The server releases the helm and clears inputs on a drop; wait for fresh state.
      this.#snapshots.clear();
      this.#setStatus('reconnecting');
    });
    room.onReconnect(() => this.#setStatus('connected'));
    room.onLeave((code) => {
      this.#closeCode = code;
      this.#stopTimers();
      this.#setStatus('disconnected');
    });
    room.onMessage(ServerMessage.ActionRejected, (payload: ActionRejectedPayload) => {
      this.#lastNotice = { code: payload.code, at: performance.now() };
    });
    // Mission rooms send each member their own items; the test room never does.
    room.onMessage(ServerMessage.Inventory, (view: MissionInventoryView) => {
      this.#inventory = view;
      for (const listener of this.#inventoryListeners) listener(view);
    });
    // Sent once, right before a mission room closes on its own (never on a plain leave).
    room.onMessage(ServerMessage.MissionOutcome, (outcome: MissionOutcomePayload) => {
      for (const listener of this.#missionOutcomeListeners) listener(outcome);
    });
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

  /** Enters the mission room of an expedition with a single-use ticket. */
  static async joinMission(
    endpoint: string,
    issued: MissionTicketResponse,
  ): Promise<SectorConnection> {
    const client = new Client(endpoint);
    client.auth.token = issued.ticket;
    const room = await client.joinById<SectorStateView>(issued.roomId);
    // Before the match starts the server frees a dropped seat at once: retrying the
    // old one would only burn the deadline. The menu offers a new entry instead.
    room.reconnection.enabled = false;
    room.onStateChange((state) => {
      if (state.phase === RoomPhase.Active) room.reconnection.enabled = true;
    });
    return new SectorConnection(room);
  }

  /** Close code sent by the server when the connection ended; null while open. */
  get closeCode(): number | null {
    return this.#closeCode;
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

  layout(): SectorLayout | null {
    return this.#layout;
  }

  /** Latest items this player can see in a mission; null outside missions. */
  inventory(): MissionInventoryView | null {
    return this.#inventory;
  }

  /** Recently received snapshots (about the last 1.5 s), for diagnostics. */
  recent(): readonly WorldSnapshot[] {
    return this.#snapshots.recent();
  }

  sample(nowMs: number): WorldSnapshot | null {
    return this.#snapshots.sample(nowMs - INTERPOLATION_DELAY_MS);
  }

  setMoveIntent(intent: MoveIntent): void {
    this.#intent = intent;
  }

  setHelmIntent(intent: HelmIntent): void {
    this.#helmIntent = intent;
  }

  get lastNotice(): Notice | null {
    return this.#lastNotice;
  }

  get isOperator(): boolean {
    return this.latest()?.ship.operatorId === this.sessionId;
  }

  toggleHelm(): void {
    if (this.#status !== 'connected') return;
    if (this.isOperator) this.releaseHelm();
    else this.#room.send(ClientMessage.HelmRequest);
  }

  releaseHelm(): void {
    if (this.#status !== 'connected' || !this.isOperator) return;
    this.#room.send(ClientMessage.HelmRelease);
  }

  transfer(request: InventoryTransfer): void {
    if (this.#status !== 'connected') return;
    this.#room.send(ClientMessage.InventoryTransfer, request);
  }

  onInventory(listener: (view: MissionInventoryView) => void): () => void {
    this.#inventoryListeners.add(listener);
    return () => this.#inventoryListeners.delete(listener);
  }

  requestExtraction(): void {
    if (this.#status !== 'connected') return;
    this.#room.send(ClientMessage.RequestExtraction);
  }

  onMissionOutcome(listener: (outcome: MissionOutcomePayload) => void): () => void {
    this.#missionOutcomeListeners.add(listener);
    return () => this.#missionOutcomeListeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  async leave(): Promise<void> {
    this.#stopTimers();
    await this.#room.leave(true);
  }

  #stopTimers(): void {
    for (const timer of this.#timers) clearInterval(timer);
  }

  /**
   * Sends the current intent at most INPUT_SEND_RATE_HZ times per second. Idle
   * players send a single neutral input and then stay silent. The operator sends
   * helm input instead of walking.
   */
  #flushInput(): void {
    if (this.#status !== 'connected') return;
    if (this.isOperator) {
      this.#flushHelm();
      return;
    }
    const { x, y } = this.#intent;
    const idle = x === 0 && y === 0;
    if (idle && this.#neutralSent) return;
    const input: CrewInput = { seq: this.#seq++, x, y };
    this.#room.send(ClientMessage.CrewInput, input);
    this.#neutralSent = idle;
  }

  #flushHelm(): void {
    const { thrust, turn } = this.#helmIntent;
    const idle = thrust === 0 && turn === 0;
    if (idle && this.#helmNeutralSent) return;
    const input: ShipInput = { seq: this.#helmSeq++, thrust, turn };
    this.#room.send(ClientMessage.ShipInput, input);
    this.#helmNeutralSent = idle;
  }

  #record(state: SectorStateView): void {
    const wasOperator = this.isOperator;
    if (!state.ship || !state.crew) return;
    // The geometry never changes during a match: copied once.
    this.#layout ??= layoutFromState(state);
    this.#snapshots.push(snapshotFromState(state, performance.now()));
    // The server numbers each operator's helm inputs from scratch.
    if (!wasOperator && this.isOperator) {
      this.#helmSeq = 0;
      this.#helmNeutralSent = true;
    }
  }

  #setStatus(status: ConnectionStatus): void {
    this.#status = status;
    if (status !== 'connected') {
      this.#intent = NEUTRAL;
      this.#helmIntent = NEUTRAL_HELM;
    }
    for (const listener of this.#statusListeners) listener(status);
  }
}
