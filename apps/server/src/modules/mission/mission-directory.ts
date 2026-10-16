import { SingleUseTickets } from '../../infrastructure/single-use-tickets';

/** Who may enter which mission room; issued to the session of an expedition member. */
export interface MissionTicket {
  readonly accountId: string;
  readonly nick: string;
  readonly expeditionId: string;
  readonly roomId: string;
}

/** Tickets into mission rooms. */
export class MissionTicketStore extends SingleUseTickets<MissionTicket> {}

/**
 * The mission room of each expedition in this process. Opening is idempotent: a
 * repeated confirmation gets the room already created (or being created).
 */
export class MissionDirectory {
  readonly #rooms = new Map<string, Promise<string>>();
  readonly #create: (expeditionId: string) => Promise<string>;

  /** `create` makes the room and resolves its ID (the matchmaker, in the server). */
  constructor(create: (expeditionId: string) => Promise<string>) {
    this.#create = create;
  }

  async open(expeditionId: string): Promise<void> {
    let room = this.#rooms.get(expeditionId);
    if (!room) {
      room = this.#create(expeditionId);
      this.#rooms.set(expeditionId, room);
      // A failed creation can be tried again by the next confirmation.
      room.catch(() => {
        if (this.#rooms.get(expeditionId) === room) this.#rooms.delete(expeditionId);
      });
    }
    await room;
  }

  /** The room of an expedition, or null when it has none (ended, or another process). */
  async roomOf(expeditionId: string): Promise<string | null> {
    const room = this.#rooms.get(expeditionId);
    if (!room) return null;
    try {
      return await room;
    } catch {
      return null;
    }
  }

  closed(expeditionId: string): void {
    this.#rooms.delete(expeditionId);
  }
}
