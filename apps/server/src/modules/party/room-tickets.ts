import { SingleUseTickets } from '../../infrastructure/single-use-tickets';

export type TicketIntent =
  | { readonly kind: 'create' }
  /** `invited`: admitted by an invite rather than the shared code. */
  | { readonly kind: 'join'; readonly roomId: string; readonly invited: boolean };

export interface TicketHolder {
  readonly accountId: string;
  readonly nick: string;
  /** Saved class choice, restored when entering any party; empty if none. */
  readonly classId: string;
  /** Ship licenses of the account when the ticket was issued. */
  readonly ships: readonly string[];
}

export interface RoomTicket extends TicketHolder {
  readonly intent: TicketIntent;
}

/** Tickets into party rooms. */
export class RoomTicketStore extends SingleUseTickets<RoomTicket> {}
