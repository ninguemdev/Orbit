import { type AuthContext, type Client, Room, ServerError } from '@colyseus/core';
import {
  PARTY_INVITE_TTL_SECONDS,
  PARTY_KICKED_CLOSE_CODE,
  PARTY_MAX_MEMBERS,
  PARTY_MOVED_CLOSE_CODE,
  PARTY_RECONNECTION_SECONDS,
  PartyClientMessage,
  PartyErrorCode,
  type ExpeditionEndedNotice,
  type PartyInviteNotice,
  type PartyRefusal,
  PartyServerMessage,
  partyInviteSchema,
  partyMemberTargetSchema,
  partyConfirmSchema,
  partySelectClassSchema,
  partySelectShipSchema,
  partySetReadySchema,
} from '@orbit/contracts';
import { isClassId, isShipHullId } from '@orbit/catalog';
import type { PartyDirectory, PartyRoomHandle } from '../modules/party/party-directory';
import type { RoomTicket, RoomTicketStore } from '../modules/party/room-tickets';
import { errorName } from '../infrastructure/error-name';
import type {
  CancelOutcome,
  ExpeditionStarter,
  ExpeditionWatcher,
} from '../modules/expedition/expedition-service';
import { PartyMemberState, PartyState } from './party-schema';

/** Remembers each account's class choice beyond the party (the profile in the database). */
export interface ClassPreferences {
  save(accountId: string, classId: string): Promise<void>;
}

/** Saved loadout of an account, checked against its saved class (the database). */
export interface LoadoutReader {
  loadout(accountId: string): Promise<readonly PreparedItem[]>;
}

export interface PreparedItem {
  readonly slot: string;
  readonly instanceId: string;
  readonly issue: string | null;
}

/** What the leader confirmed: the roster of one revision, kept for the mission (0.3). */
export interface PreparationProposal {
  readonly revision: number;
  readonly shipId: string;
  readonly members: readonly {
    readonly accountId: string;
    readonly classId: string;
    readonly loadout: readonly PreparedItem[];
  }[];
}

/** Creates the mission room of an expedition (idempotent per expedition). */
export interface MissionOpener {
  open(expeditionId: string): Promise<void>;
}

export interface PartyRoomDeps {
  readonly tickets: RoomTicketStore;
  readonly directory: PartyDirectory;
  readonly classPreferences?: ClassPreferences;
  /** Without it (tests without a database) every loadout counts as empty and valid. */
  readonly loadouts?: LoadoutReader;
  /** Reserves the confirmed loadouts; without it a confirmation only freezes the roster. */
  readonly expeditions?: ExpeditionStarter;
  /** Opens the match room of a reserved expedition; without it nobody can load in. */
  readonly missions?: MissionOpener;
  readonly now?: () => number;
}

type PartyClient = Client<{ auth: RoomTicket }>;

/**
 * A party: up to four accounts preparing together. Entry requires a single-use
 * ticket issued to an authenticated session; the leader manages members.
 */
export class PartyRoom
  extends Room<{ state: PartyState; client: PartyClient }>
  implements PartyRoomHandle
{
  override maxClients = PARTY_MAX_MEMBERS;
  override maxMessagesPerSecond = 20;
  override state = new PartyState();

  /** Replaced by `definePartyRoom`. */
  protected deps: PartyRoomDeps | undefined;
  inviteCode = '';
  readonly #clients = new Map<string, PartyClient>();
  /** Members removed on purpose (kicked or moved): their drop gets no reconnection. */
  readonly #removed = new Set<string>();
  /** Removed by the leader: the invite code no longer admits them, a new invite does. */
  readonly #kicked = new Set<string>();

  /** Refuses everyone unless registered through `definePartyRoom`. */
  static override async onAuth(
    _token: string,
    _options: unknown,
    _context: AuthContext,
  ): Promise<RoomTicket> {
    throw new ServerError(403, 'invalid_ticket');
  }

  get #deps(): PartyRoomDeps {
    if (!this.deps) throw new Error('PartyRoom sem dependências');
    return this.deps;
  }

  override onCreate(): void {
    this.inviteCode = this.#deps.directory.newInviteCode();
    this.state.inviteCode = this.inviteCode;
    this.#deps.directory.register(this);
    void this.setPrivate(true);

    this.onMessage(PartyClientMessage.Invite, (client: PartyClient, raw: unknown) => {
      const parsed = partyInviteSchema.safeParse(raw);
      if (!parsed.success)
        return this.#refuse(client, PartyClientMessage.Invite, PartyErrorCode.InvalidPayload);
      this.#invite(client, parsed.data.nick);
    });
    this.onMessage(PartyClientMessage.Kick, (client: PartyClient, raw: unknown) => {
      const parsed = partyMemberTargetSchema.safeParse(raw);
      if (!parsed.success)
        return this.#refuse(client, PartyClientMessage.Kick, PartyErrorCode.InvalidPayload);
      this.#kick(client, parsed.data.accountId);
    });
    this.onMessage(PartyClientMessage.Promote, (client: PartyClient, raw: unknown) => {
      const parsed = partyMemberTargetSchema.safeParse(raw);
      if (!parsed.success)
        return this.#refuse(client, PartyClientMessage.Promote, PartyErrorCode.InvalidPayload);
      this.#promote(client, parsed.data.accountId);
    });
    this.onMessage(PartyClientMessage.SelectClass, (client: PartyClient, raw: unknown) => {
      const action = PartyClientMessage.SelectClass;
      const parsed = partySelectClassSchema.safeParse(raw);
      if (!parsed.success) return this.#refuse(client, action, PartyErrorCode.InvalidPayload);
      const { classId } = parsed.data;
      if (!isClassId(classId)) return this.#refuse(client, action, PartyErrorCode.UnknownClass);
      const accountId = client.auth?.accountId;
      const member = accountId ? this.state.members.get(accountId) : undefined;
      if (!accountId || !member || this.#clients.get(accountId) !== client) {
        return this.#refuse(client, action, PartyErrorCode.NotMember);
      }
      // Each member chooses their own class; repeated classes are allowed.
      const preferences = this.#deps.classPreferences;
      if (!preferences) {
        if (member.classId !== classId) this.#changed();
        member.classId = classId;
        return;
      }
      // The class is shown only after the account remembers it, so every server check
      // of the class (loadout, readiness) agrees with what the party displays. Saves of
      // one account run in order, so the last choice wins.
      const previous = this.#classSaves.get(accountId) ?? Promise.resolve();
      const next = previous.then(async () => {
        try {
          await preferences.save(accountId, classId);
        } catch (error) {
          const name = error instanceof Error ? error.name : typeof error;
          console.error(`[party] não foi possível salvar a classe: ${name}`);
          this.#refuse(client, action, PartyErrorCode.ClassNotSaved);
          return;
        }
        const current = this.state.members.get(accountId);
        if (current && current.classId !== classId) {
          current.classId = classId;
          this.#changed();
        }
      });
      this.#classSaves.set(accountId, next);
      void next.finally(() => {
        if (this.#classSaves.get(accountId) === next) this.#classSaves.delete(accountId);
      });
    });
    this.onMessage(PartyClientMessage.SelectShip, (client: PartyClient, raw: unknown) => {
      const action = PartyClientMessage.SelectShip;
      const parsed = partySelectShipSchema.safeParse(raw);
      if (!parsed.success) return this.#refuse(client, action, PartyErrorCode.InvalidPayload);
      if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
      // Any current member's license makes the ship available to the whole party.
      if (!this.#availableShips().has(parsed.data.shipId)) {
        return this.#refuse(client, action, PartyErrorCode.ShipUnavailable);
      }
      if (this.state.selectedShipId === parsed.data.shipId) return;
      this.state.selectedShipId = parsed.data.shipId;
      this.#changed();
    });
    this.onMessage(PartyClientMessage.SetReady, (client: PartyClient, raw: unknown) => {
      const parsed = partySetReadySchema.safeParse(raw);
      if (!parsed.success) {
        return this.#refuse(client, PartyClientMessage.SetReady, PartyErrorCode.InvalidPayload);
      }
      void this.#setReady(client, parsed.data.revision, parsed.data.ready);
    });
    this.onMessage(PartyClientMessage.Confirm, (client: PartyClient, raw: unknown) => {
      const parsed = partyConfirmSchema.safeParse(raw);
      if (!parsed.success) {
        return this.#refuse(client, PartyClientMessage.Confirm, PartyErrorCode.InvalidPayload);
      }
      void this.#confirm(client, parsed.data.revision);
    });
    this.onMessage('*', (client: PartyClient, type) => {
      this.#refuse(client, String(type), PartyErrorCode.InvalidPayload);
    });
  }

  override onJoin(client: PartyClient): void {
    const ticket = client.auth;
    if (!ticket) throw new ServerError(403, 'invalid_ticket');
    const { intent, accountId, nick } = ticket;
    if (intent.kind === 'join' && intent.roomId !== this.roomId) {
      throw new ServerError(403, 'invalid_ticket');
    }
    if (intent.kind === 'create' && this.state.members.size > 0) {
      throw new ServerError(403, 'invalid_ticket');
    }
    if (this.state.members.has(accountId)) throw new ServerError(409, PartyErrorCode.AlreadyMember);
    if (this.#kicked.has(accountId) && intent.kind === 'join' && !intent.invited) {
      throw new ServerError(403, 'removed_from_party');
    }
    this.#kicked.delete(accountId);

    const member = new PartyMemberState();
    member.accountId = accountId;
    member.nick = nick;
    member.connected = true;
    member.joinedAt = this.#now();
    member.classId = isClassId(ticket.classId) ? ticket.classId : '';
    // Licenses as read when the ticket was issued (already in catalog order); IDs the
    // catalog does not know cannot be chosen, so they are left out.
    for (const shipId of ticket.ships) if (isShipHullId(shipId)) member.ships.push(shipId);
    const creator = this.state.members.size === 0;
    this.state.members.set(accountId, member);
    if (!this.state.leaderId) this.state.leaderId = accountId;
    // A new party starts with its creator's first ship in catalog order. Later
    // arrivals never choose: an empty choice waits for the leader.
    if (creator) this.state.selectedShipId = member.ships.at(0) ?? '';
    this.#clients.set(accountId, client);
    this.#removed.delete(accountId);
    this.#deps.directory.joined(accountId, nick, this.roomId);
    this.#changed();
  }

  override onDrop(client: PartyClient): void {
    const accountId = client.auth?.accountId;
    // Also called for a connection whose join was refused; it never became a member.
    if (!accountId || this.#clients.get(accountId) !== client) return;
    const member = this.state.members.get(accountId);
    if (member) member.connected = false;
    // A dropped member cannot confirm anything: readiness starts over.
    this.#changed();
    if (!this.#removed.has(accountId)) {
      // Rejects when the client dropped before finishing the join handshake or when the
      // seat expires; Colyseus then calls onLeave. Unhandled, it would end the process.
      this.allowReconnection(client, PARTY_RECONNECTION_SECONDS).catch(() => undefined);
    }
  }

  override onReconnect(client: PartyClient): void {
    const accountId = client.auth?.accountId;
    const member = accountId ? this.state.members.get(accountId) : undefined;
    if (!accountId || !member) {
      // Removed while disconnected (kicked, or joined another party): the seat was
      // still reserved, but the member is gone.
      const kicked = accountId !== undefined && this.#kicked.has(accountId);
      client.leave(kicked ? PARTY_KICKED_CLOSE_CODE : PARTY_MOVED_CLOSE_CODE);
      return;
    }
    member.connected = true;
    this.#clients.set(accountId, client);
  }

  override onLeave(client: PartyClient): void {
    const accountId = client.auth?.accountId;
    // A refused join (e.g. the same account in a second tab) must not remove the
    // member connected through another client.
    if (!accountId || this.#clients.get(accountId) !== client) return;
    this.#clients.delete(accountId);
    this.#removeMember(accountId);
  }

  override onDispose(): void {
    this.#deps.directory.unregister(this);
    // Nobody is left to start the match: the reserved items go back now.
    this.#unwatch?.();
    this.#unwatch = null;
    const expedition = this.#expedition;
    this.#clearExpedition();
    if (expedition) void this.#cancelExpedition(expedition.id);
  }

  // PartyRoomHandle ------------------------------------------------------------

  memberCount(): number {
    return this.state.members.size;
  }

  hasMember(accountId: string): boolean {
    return this.state.members.has(accountId);
  }

  refusesAccount(accountId: string): boolean {
    return this.#kicked.has(accountId);
  }

  notifyInvite(accountId: string, notice: PartyInviteNotice): boolean {
    const client = this.#clients.get(accountId);
    // A member in the reconnection window cannot see it now.
    if (!client || !this.state.members.get(accountId)?.connected) return false;
    client.send(PartyServerMessage.InviteReceived, notice);
    return true;
  }

  evict(accountId: string): void {
    this.#removeOnPurpose(accountId, PARTY_MOVED_CLOSE_CODE, 'moved_to_another_party');
  }

  preparationChanged(accountId: string): void {
    if (this.state.members.has(accountId)) this.#changed();
  }

  /** The confirmed proposal of the current revision, if any. */
  get proposal(): PreparationProposal | null {
    return this.#proposal;
  }

  // Rules ------------------------------------------------------------------------

  #invite(client: PartyClient, nick: string): void {
    const action = PartyClientMessage.Invite;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    if (this.state.members.size >= PARTY_MAX_MEMBERS) {
      return this.#refuse(client, action, PartyErrorCode.PartyFull);
    }
    const target = this.#deps.directory.findOnline(nick);
    if (!target) return this.#refuse(client, action, PartyErrorCode.PlayerOffline);
    if (this.state.members.has(target.accountId)) {
      return this.#refuse(client, action, PartyErrorCode.AlreadyMember);
    }
    // A new invite is the way back for a removed member.
    this.#kicked.delete(target.accountId);
    const invite = this.#deps.directory.createInvite(
      this.roomId,
      target.accountId,
      client.auth?.nick ?? '',
    );
    const delivered = this.#deps.directory.room(target.roomId)?.notifyInvite(target.accountId, {
      inviteId: invite.id,
      fromNick: client.auth?.nick ?? '',
      memberCount: this.state.members.size,
      expiresInSeconds: PARTY_INVITE_TTL_SECONDS,
    });
    if (!delivered) this.#refuse(client, action, PartyErrorCode.PlayerOffline);
  }

  #kick(client: PartyClient, targetId: string): void {
    const action = PartyClientMessage.Kick;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    if (targetId === client.auth?.accountId || !this.state.members.has(targetId)) {
      return this.#refuse(client, action, PartyErrorCode.NotMember);
    }
    this.#kicked.add(targetId);
    this.#removeOnPurpose(targetId, PARTY_KICKED_CLOSE_CODE, 'kicked_by_leader');
  }

  /**
   * Removes a member now. A connected one is disconnected with `code`; a dropped one
   * is taken off the list at once (closing their dead socket would do nothing), and a
   * later reconnection is turned away in onReconnect.
   */
  #removeOnPurpose(accountId: string, code: number, reason: string): void {
    this.#removed.add(accountId);
    const member = this.state.members.get(accountId);
    const client = this.#clients.get(accountId);
    if (client && member?.connected) {
      client.leave(code, reason);
      return;
    }
    this.#removeMember(accountId);
  }

  #promote(client: PartyClient, targetId: string): void {
    const action = PartyClientMessage.Promote;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    if (!this.state.members.has(targetId))
      return this.#refuse(client, action, PartyErrorCode.NotMember);
    if (this.state.leaderId === targetId) return;
    this.state.leaderId = targetId;
    // The reserved expedition names its leader: a new leader confirms again.
    if (this.#expedition) this.#changed();
  }

  #removeMember(accountId: string): void {
    if (!this.state.members.delete(accountId)) return;
    this.#changed();
    this.#deps.directory.left(accountId, this.roomId);
    if (this.state.leaderId === accountId) this.state.leaderId = this.#nextLeader();
    // The last owner of the selected ship left: the choice is no longer valid.
    if (this.state.selectedShipId && !this.#availableShips().has(this.state.selectedShipId)) {
      this.state.selectedShipId = '';
    }
  }

  /** Union of the members' ship licenses, without duplicates. */
  #availableShips(): Set<string> {
    const ships = new Set<string>();
    this.state.members.forEach((member) => member.ships.forEach((shipId) => ships.add(shipId)));
    return ships;
  }

  /** The longest-standing member leads; connected members are preferred. */
  #nextLeader(): string {
    const members = [...this.state.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    return (members.find((member) => member.connected) ?? members[0])?.accountId ?? '';
  }

  #isLeader(client: PartyClient): boolean {
    return client.auth?.accountId === this.state.leaderId;
  }

  /** Pending class saves per account, chained so they finish in order. */
  readonly #classSaves = new Map<string, Promise<void>>();
  #proposal: PreparationProposal | null = null;
  /** Expedition created by the confirmation of `revision`, while it waits to start. */
  #expedition: {
    readonly id: string;
    readonly revision: number;
    readonly deadline: number;
    readonly memberIds: readonly string[];
  } | null = null;
  /** Revision whose expedition is being created right now. */
  #starting: number | null = null;
  /** Cancellations not yet committed; a new start waits for them. */
  readonly #pendingCancels = new Set<Promise<CancelOutcome>>();
  #countdown: ReturnType<typeof setInterval> | null = null;
  /** Stops following the expedition this party started last. */
  #unwatch: (() => void) | null = null;
  /** Latest readiness request per member; older answers are dropped. */
  readonly #readyRequests = new Map<string, number>();

  #logFailure(what: string, error: unknown): void {
    console.error(`[party] não foi possível ${what}: ${errorName(error)}`);
  }

  // Preparation -----------------------------------------------------------------

  /**
   * A change that matters for the mission: a new revision, nobody ready, and no
   * confirmation. Requests naming the previous revision will fail.
   */
  #changed(): void {
    // The confirmed roster no longer holds: its preparation is cancelled.
    if (this.#expedition) this.#endExpedition('party_changed');
    this.state.revision += 1;
    this.state.confirmedRevision = 0;
    this.#proposal = null;
    this.state.members.forEach((member) => {
      member.ready = false;
    });
  }

  /** Problems that keep a member from being ready, read from the saved loadout. */
  async #loadoutOf(accountId: string): Promise<readonly PreparedItem[]> {
    return (await this.#deps.loadouts?.loadout(accountId)) ?? [];
  }

  async #setReady(client: PartyClient, revision: number, ready: boolean): Promise<void> {
    const action = PartyClientMessage.SetReady;
    const accountId = client.auth?.accountId;
    const member = accountId ? this.state.members.get(accountId) : undefined;
    if (!accountId || !member || this.#clients.get(accountId) !== client) {
      return this.#refuse(client, action, PartyErrorCode.NotMember);
    }
    if (revision !== this.state.revision) {
      return this.#refuse(client, action, PartyErrorCode.StaleRevision);
    }
    // Only the member's latest request counts, even if an earlier one finishes later.
    const request = (this.#readyRequests.get(accountId) ?? 0) + 1;
    this.#readyRequests.set(accountId, request);
    if (!ready) {
      // Leaving a reserved preparation cancels it for everyone (a new revision).
      if (this.#expedition) return this.#changed();
      member.ready = false;
      // A confirmation needs everyone ready; it no longer holds.
      this.state.confirmedRevision = 0;
      this.#proposal = null;
      return;
    }
    if (!member.classId) return this.#refuse(client, action, PartyErrorCode.ClassMissing);
    if (member.ready) return;
    let loadout: readonly PreparedItem[];
    try {
      loadout = await this.#loadoutOf(accountId);
    } catch (error) {
      this.#logFailure('ler o loadout', error);
      return this.#refuse(client, action, PartyErrorCode.PreparationUnavailable);
    }
    // A later request from the same member replaced this one.
    if (this.#readyRequests.get(accountId) !== request) return;
    // Anything may have changed while the loadout was read.
    if (revision !== this.state.revision || this.state.members.get(accountId) !== member) {
      return this.#refuse(client, action, PartyErrorCode.StaleRevision);
    }
    if (loadout.some((item) => item.issue !== null)) {
      return this.#refuse(client, action, PartyErrorCode.LoadoutInvalid);
    }
    member.ready = true;
  }

  /**
   * Why the confirmation of `revision` with this roster no longer holds, if it does
   * not: checked again after every wait, since anything may change meanwhile
   * (leadership, someone no longer ready, which keeps the revision, or leaving).
   */
  #confirmationProblem(
    client: PartyClient,
    revision: number,
    members: readonly PartyMemberState[],
  ): PartyErrorCode | null {
    if (revision !== this.state.revision) return PartyErrorCode.StaleRevision;
    if (!this.#isLeader(client)) return PartyErrorCode.NotLeader;
    const now = [...this.state.members.values()];
    const sameRoster =
      now.length === members.length && now.every((member, index) => member === members[index]);
    if (!sameRoster) return PartyErrorCode.StaleRevision;
    if (now.some((member) => !member.ready || !member.connected)) {
      return PartyErrorCode.MembersNotReady;
    }
    return null;
  }

  async #confirm(client: PartyClient, revision: number): Promise<void> {
    const action = PartyClientMessage.Confirm;
    if (!this.#isLeader(client)) return this.#refuse(client, action, PartyErrorCode.NotLeader);
    // The party's match is running: nothing to confirm until it ends.
    if (this.state.expeditionState === 'ACTIVE') {
      return this.#refuse(client, action, PartyErrorCode.MemberInExpedition);
    }
    if (revision !== this.state.revision) {
      return this.#refuse(client, action, PartyErrorCode.StaleRevision);
    }
    const shipId = this.state.selectedShipId;
    if (!shipId) return this.#refuse(client, action, PartyErrorCode.ShipMissing);
    const members = [...this.state.members.values()];
    if (members.some((member) => !member.ready || !member.connected)) {
      return this.#refuse(client, action, PartyErrorCode.MembersNotReady);
    }
    // A repeated confirmation of the same revision changes nothing.
    if (this.#expedition?.revision === revision || this.#starting === revision) return;
    // The loadouts are read again: the proposal records exactly what each member takes.
    let loadouts: (readonly PreparedItem[])[];
    try {
      loadouts = await Promise.all(members.map((member) => this.#loadoutOf(member.accountId)));
    } catch (error) {
      this.#logFailure('ler os loadouts', error);
      return this.#refuse(client, action, PartyErrorCode.PreparationUnavailable);
    }
    const problem = this.#confirmationProblem(client, revision, members);
    if (problem) return this.#refuse(client, action, problem);
    if (loadouts.some((loadout) => loadout.some((item) => item.issue !== null))) {
      return this.#refuse(client, action, PartyErrorCode.LoadoutInvalid);
    }
    const proposal: PreparationProposal = {
      revision,
      shipId,
      members: members.map((member, index) => ({
        accountId: member.accountId,
        classId: member.classId,
        loadout: loadouts[index] ?? [],
      })),
    };
    const expeditions = this.#deps.expeditions;
    if (!expeditions) {
      this.#proposal = proposal;
      this.state.confirmedRevision = revision;
      return;
    }
    if (this.#expedition?.revision === revision || this.#starting === revision) return;
    this.#starting = revision;
    try {
      await this.#startExpedition(client, expeditions, proposal, members);
    } finally {
      if (this.#starting === revision) this.#starting = null;
    }
  }

  /**
   * Reserves the confirmed loadouts. The start key names the revision, so a retry
   * after a lost answer gets the same expedition. If the party changed while the
   * database worked, the new expedition is cancelled and the revision moves on, so
   * that key is never needed again.
   */
  async #startExpedition(
    client: PartyClient,
    expeditions: ExpeditionStarter,
    proposal: PreparationProposal,
    members: readonly PartyMemberState[],
  ): Promise<void> {
    const action = PartyClientMessage.Confirm;
    const { revision } = proposal;
    // An earlier preparation of these members may still be returning its items.
    await Promise.all([...this.#pendingCancels]);
    // Events name the expedition this start creates, known once it answers.
    let startedId = '';
    const watcher: ExpeditionWatcher = {
      onCancelled: (reason) => {
        // A cancellation this party asked for was already handled.
        if (reason !== 'party_changed') this.#preparationExpired(startedId);
      },
      onActivated: () => this.#missionStarted(startedId),
      onSettled: () => this.#missionEnded(startedId, 'settled'),
      onAborted: () => this.#missionEnded(startedId, 'aborted'),
    };
    let started: Awaited<ReturnType<ExpeditionStarter['start']>>;
    try {
      started = await expeditions.start(
        {
          partyKey: `${this.roomId}:${revision}`,
          leaderAccountId: this.state.leaderId,
          shipId: proposal.shipId,
          members: proposal.members.map((member) => ({
            accountId: member.accountId,
            classId: member.classId,
            loadout: member.loadout.map(({ slot, instanceId }) => ({ slot, instanceId })),
          })),
        },
        watcher,
      );
    } catch (error) {
      this.#logFailure('reservar os itens', error);
      return this.#refuse(client, action, PartyErrorCode.PreparationUnavailable);
    }
    if (!started.ok) return this.#refuse(client, action, started.code);
    startedId = started.expeditionId;
    this.#unwatch?.();
    this.#unwatch = started.unwatch;
    // A late retry may name an expedition that already started: it is not a new one.
    if (started.state !== 'PREPARING') {
      return this.#refuse(client, action, PartyErrorCode.MemberInExpedition);
    }
    try {
      await this.#deps.missions?.open(startedId);
    } catch (error) {
      this.#logFailure('abrir a sala da missão', error);
      void this.#cancelExpedition(startedId);
      this.#changed();
      return this.#refuse(client, action, PartyErrorCode.PreparationUnavailable);
    }
    const problem = this.#confirmationProblem(client, revision, members);
    if (problem) {
      void this.#cancelExpedition(started.expeditionId);
      this.#changed();
      return this.#refuse(client, action, problem);
    }
    this.#expedition = {
      id: started.expeditionId,
      revision,
      deadline: started.prepareDeadline,
      memberIds: proposal.members.map((member) => member.accountId),
    };
    this.state.expeditionId = started.expeditionId;
    this.#setExpeditionMembers(this.#expedition.memberIds);
    this.state.expeditionState = 'PREPARING';
    this.#proposal = proposal;
    this.state.confirmedRevision = revision;
    this.#startCountdown();
  }

  /** Seconds left before the deadline, counted on the server's clock. */
  #startCountdown(): void {
    this.#stopCountdown();
    const tick = () => {
      const deadline = this.#expedition?.deadline ?? 0;
      this.state.prepareSecondsLeft = Math.max(0, Math.ceil((deadline - this.#now()) / 1000));
    };
    tick();
    this.#countdown = setInterval(tick, 1000);
    this.#countdown.unref();
  }

  #stopCountdown(): void {
    if (this.#countdown) clearInterval(this.#countdown);
    this.#countdown = null;
  }

  /** Every member loaded: the match belongs to the mission room from now on. */
  #missionStarted(expeditionId: string): void {
    if (this.#expedition?.id !== expeditionId) return;
    this.#showRunning(expeditionId, this.#expedition.memberIds);
  }

  /**
   * Detaches the party from a running match: readiness and confirmation start over
   * (a new revision), and the party shows the match until it ends.
   */
  #showRunning(expeditionId: string, memberIds: readonly string[]): void {
    this.#expedition = null;
    this.#stopCountdown();
    this.#changed();
    this.state.expeditionId = expeditionId;
    this.#setExpeditionMembers(memberIds);
    this.state.expeditionState = 'ACTIVE';
    this.state.prepareSecondsLeft = 0;
  }

  /** The match ended: settled (extracted, destroyed or timed out) or a technical abort. */
  #missionEnded(expeditionId: string, reason: 'settled' | 'aborted'): void {
    if (!expeditionId || this.state.expeditionId !== expeditionId) return;
    this.#clearExpedition();
    this.#notifyExpeditionEnded(reason);
    this.#changed();
  }

  /**
   * The preparation ended without a match (deadline, or its room closed): the
   * service already returned the items.
   */
  #preparationExpired(expeditionId: string): void {
    if (!expeditionId || this.#expedition?.id !== expeditionId) return;
    this.#clearExpedition();
    this.#notifyExpeditionEnded('expired');
    this.#changed();
  }

  /**
   * Cancels the preparation because the party changed. The members are told once the
   * items are back in the database, so the stash they reload is already free.
   */
  #endExpedition(reason: ExpeditionEndedNotice['reason']): void {
    const expedition = this.#expedition;
    if (!expedition) return;
    this.#clearExpedition();
    void this.#cancelExpedition(expedition.id).then((outcome) => {
      if (outcome === 'cancelled') this.#notifyExpeditionEnded(reason);
      // The match became active before the cancellation reached the database.
      else if (outcome === 'not_preparing' && !this.state.expeditionId) {
        this.#showRunning(expedition.id, expedition.memberIds);
      }
    });
  }

  #clearExpedition(): void {
    this.#expedition = null;
    this.#stopCountdown();
    this.state.expeditionId = '';
    this.state.expeditionState = '';
    this.state.prepareSecondsLeft = 0;
    this.state.expeditionMemberIds.clear();
  }

  #setExpeditionMembers(memberIds: readonly string[]): void {
    this.state.expeditionMemberIds.clear();
    for (const accountId of memberIds) this.state.expeditionMemberIds.push(accountId);
  }

  /** Resolves with the outcome once the database answered (`retrying` on failure). */
  #cancelExpedition(expeditionId: string): Promise<CancelOutcome> {
    const expeditions = this.#deps.expeditions;
    if (!expeditions) return Promise.resolve('cancelled');
    const cancelling = expeditions
      .cancel(expeditionId, 'party_changed')
      .catch((error: unknown): CancelOutcome => {
        this.#logFailure('cancelar a preparação', error);
        return 'retrying';
      });
    this.#pendingCancels.add(cancelling);
    void cancelling.finally(() => this.#pendingCancels.delete(cancelling));
    return cancelling;
  }

  #notifyExpeditionEnded(reason: ExpeditionEndedNotice['reason']): void {
    const notice: ExpeditionEndedNotice = { reason };
    this.broadcast(PartyServerMessage.ExpeditionEnded, notice);
  }

  #refuse(client: PartyClient, action: string, code: PartyErrorCode): void {
    const refusal: PartyRefusal = { action, code };
    client.send(PartyServerMessage.Refused, refusal);
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)();
  }
}

/** Binds the party room to this server's ticket store and directory. */
export function definePartyRoom(deps: PartyRoomDeps): typeof PartyRoom {
  return class ConfiguredPartyRoom extends PartyRoom {
    protected override deps: PartyRoomDeps | undefined = deps;

    static override async onAuth(
      token: string,
      _options: unknown,
      _context: AuthContext,
    ): Promise<RoomTicket> {
      const ticket = deps.tickets.consume(token);
      if (!ticket) throw new ServerError(403, 'invalid_ticket');
      return ticket;
    }
  };
}
