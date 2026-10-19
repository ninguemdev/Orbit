import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ShipHullId } from '@orbit/catalog';
import {
  AccountRoute,
  type ExpeditionEndedNotice,
  PartyClientMessage,
  type PartyRefusal,
  PartyServerMessage,
} from '@orbit/contracts';
import {
  cancelPreparation,
  getActiveExpedition,
  startExpedition,
  updateProfileClass,
} from '@orbit/database';
import { ExpeditionService } from '../src/modules/expedition/expedition-service';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';
import { POLICY, eventually, partyHelpers, readyCount, waitFor } from './party-helpers';

describe('party confirmation reserves the expedition', () => {
  let api: ApiServer;
  const h = partyHelpers(() => api);

  beforeAll(async () => {
    api = await startApiServer(POLICY);
  });

  afterEach(async () => {
    await h.leaveAll();
  });

  afterAll(async () => {
    await api?.close();
  });

  it('reserves every loadout and keeps it fixed while preparing', async () => {
    const { leader, guest, party, guestRoom, pistols } = await h.readyPair();
    await h.confirm(party);
    expect(party.state.confirmedRevision).toBe(party.state.revision);
    expect(party.state.prepareSecondsLeft).toBeGreaterThan(20);
    await waitFor(() => guestRoom.state.expeditionId === party.state.expeditionId, 'convidado vê');

    for (const [who, pistol] of [
      [leader, pistols.leader],
      [guest, pistols.guest],
    ] as const) {
      const active = await getActiveExpedition(api.db, who.id);
      expect(active?.expeditionId).toBe(party.state.expeditionId);
      expect(active?.reserved.map((item) => item.instanceId)).toEqual([pistol]);
      const stash = (await h.inventory(who)).stash;
      expect(stash.find((entry) => entry.instanceId === pistol)?.reserved).toBe(true);
    }

    const changed = await call(api.baseUrl, AccountRoute.MyLoadout, {
      method: 'PUT',
      origin: ALLOWED_ORIGIN,
      token: guest.token,
      body: { picks: [] },
    });
    expect(changed.status).toBe(409);
    expect(changed.body).toEqual({ error: 'in_expedition' });

    // Confirming the same revision again keeps the same expedition.
    const id = party.state.expeditionId;
    party.send(PartyClientMessage.Confirm, { revision: party.state.revision });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(party.state.expeditionId).toBe(id);
    expect((await getActiveExpedition(api.db, leader.id))?.expeditionId).toBe(id);
  });

  it('cancels the preparation and returns the items when the party changes', async () => {
    const { leader, guest, party, guestRoom, pistols } = await h.readyPair();
    const ended = h.messages<ExpeditionEndedNotice>(guestRoom, PartyServerMessage.ExpeditionEnded);
    await h.confirm(party);
    const first = party.state.expeditionId;
    const revision = party.state.revision;

    guestRoom.send(PartyClientMessage.SetReady, { revision, ready: false });
    await waitFor(() => ended.length === 1, 'aviso de cancelamento');
    expect(ended[0]).toEqual({ reason: 'party_changed' });
    await waitFor(() => party.state.expeditionId === '', 'preparação desfeita');
    expect(party.state.revision).toBeGreaterThan(revision);
    expect(readyCount(party)).toBe(0);
    // The notice comes after the cancellation is committed.
    expect(await getActiveExpedition(api.db, guest.id)).toBeNull();
    const stash = (await h.inventory(guest)).stash;
    expect(stash.find((entry) => entry.instanceId === pistols.guest)?.reserved).toBe(false);

    // The next confirmation is a new expedition with the same items.
    await h.readyAll(party, guestRoom);
    await h.confirm(party);
    expect(party.state.expeditionId).not.toBe(first);
    expect((await getActiveExpedition(api.db, leader.id))?.reserved).toHaveLength(1);
  });

  it('cancels the preparation when a member leaves the party', async () => {
    const { guest, party, guestRoom } = await h.readyPair();
    await h.confirm(party);
    await guestRoom.leave();
    await waitFor(() => party.state.expeditionId === '', 'preparação desfeita');
    await eventually(
      async () => (await getActiveExpedition(api.db, guest.id)) === null,
      'reservas devolvidas',
    );
  });

  it('refuses the confirmation when a member is in another expedition', async () => {
    const { leader, guest, party, pistols } = await h.readyPair();
    const refused = h.messages<PartyRefusal>(party, PartyServerMessage.Refused);
    // Another expedition (e.g. left by an earlier process) already holds the guest.
    const other = await startExpedition(api.db, {
      startKey: randomUUID(),
      leaderAccountId: guest.id,
      shipId: ShipHullId.Scout,
      members: [
        {
          accountId: guest.id,
          classId: 'class.engineer',
          loadout: [{ slot: 'sidearm', instanceId: pistols.guest }],
        },
      ],
    });
    if (!other.ok) throw new Error(other.reason);

    party.send(PartyClientMessage.Confirm, { revision: party.state.revision });
    await waitFor(() => refused.length === 1, 'recusa');
    expect(refused[0]?.code).toBe('member_in_expedition');
    expect(party.state.expeditionId).toBe('');
    expect(await getActiveExpedition(api.db, leader.id)).toBeNull();
    expect(await cancelPreparation(api.db, other.expeditionId)).toBe('cancelled');
  });

  it('cancels the preparation when the leader passes leadership', async () => {
    const { guest, party, guestRoom } = await h.readyPair();
    await h.confirm(party);
    const first = party.state.expeditionId;
    party.send(PartyClientMessage.Promote, { accountId: guest.id });
    await waitFor(() => party.state.expeditionId === '', 'preparação desfeita');
    await eventually(
      async () => (await getActiveExpedition(api.db, guest.id)) === null,
      'reservas devolvidas',
    );
    // The new leader confirms a new expedition.
    await h.readyAll(party, guestRoom);
    await h.confirm(guestRoom);
    expect(guestRoom.state.expeditionId).not.toBe(first);
  });
});

describe('preparation deadline', () => {
  let api: ApiServer;
  const h = partyHelpers(() => api);

  beforeAll(async () => {
    api = await startApiServer(POLICY, {}, { prepareSeconds: 1 });
  });

  afterEach(async () => {
    await h.leaveAll();
  });

  afterAll(async () => {
    await api?.close();
  });

  it('cancels a preparation that does not start in time', async () => {
    const { leader, party, guestRoom } = await h.readyPair();
    const ended = h.messages<ExpeditionEndedNotice>(guestRoom, PartyServerMessage.ExpeditionEnded);
    const revision = party.state.revision;
    await h.confirm(party);

    await waitFor(() => ended.length === 1, 'prazo vencido', 5000);
    expect(ended[0]).toEqual({ reason: 'expired' });
    await waitFor(() => party.state.expeditionId === '', 'preparação desfeita');
    expect(party.state.revision).toBeGreaterThan(revision);
    expect(readyCount(party)).toBe(0);
    expect(await getActiveExpedition(api.db, leader.id)).toBeNull();
  });

  it('cancels, after a restart, the preparations the previous process left', async () => {
    const leader = await h.player();
    await updateProfileClass(api.db, leader.id, 'class.pilot');
    const pistol = await h.equipPistol(leader);
    const started = await startExpedition(api.db, {
      startKey: randomUUID(),
      leaderAccountId: leader.id,
      shipId: ShipHullId.Scout,
      members: [
        {
          accountId: leader.id,
          classId: 'class.pilot',
          loadout: [{ slot: 'sidearm', instanceId: pistol }],
        },
      ],
      prepareSeconds: 1,
    });
    if (!started.ok) throw new Error(started.reason);

    // A new process finds it without a room and cancels it at its deadline.
    const restarted = new ExpeditionService(api.db);
    try {
      expect((await restarted.recover()).preparing).toBeGreaterThanOrEqual(1);
      await eventually(
        async () => (await getActiveExpedition(api.db, leader.id)) === null,
        'preparação órfã cancelada',
      );
    } finally {
      await restarted.close();
    }
    const stash = (await h.inventory(leader)).stash;
    expect(stash.find((entry) => entry.instanceId === pistol)?.reserved).toBe(false);
  });
});

describe('confirmation racing with the party', () => {
  let api: ApiServer;
  const h = partyHelpers(() => api);
  /** While set, starts wait for it: the party can change in the middle of one. */
  let gate: Promise<void> | null = null;

  beforeAll(async () => {
    api = await startApiServer(
      POLICY,
      {},
      {
        wrapExpeditions: (service) => ({
          start: async (request, watcher) => {
            await gate;
            return service.start(request, watcher);
          },
          cancel: (expeditionId, reason) => service.cancel(expeditionId, reason),
          watch: (expeditionId, watcher) => service.watch(expeditionId, watcher),
          roster: (expeditionId) => service.roster(expeditionId),
          activate: (expeditionId) => service.activate(expeditionId),
          abort: (expeditionId) => service.abort(expeditionId),
          settle: (expeditionId, manifest, hash) => service.settle(expeditionId, manifest, hash),
        }),
      },
    );
  });

  afterEach(async () => {
    gate = null;
    await h.leaveAll();
  });

  afterAll(async () => {
    await api?.close();
  });

  it('retires the revision when the party changes during the start', async () => {
    const { leader, party, guestRoom } = await h.readyPair();
    const refused = h.messages<PartyRefusal>(party, PartyServerMessage.Refused);
    let release: () => void = () => undefined;
    gate = new Promise((resolve) => (release = resolve));
    const revision = party.state.revision;
    party.send(PartyClientMessage.Confirm, { revision });
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Not ready keeps the revision while no expedition exists yet.
    guestRoom.send(PartyClientMessage.SetReady, { revision, ready: false });
    await waitFor(() => readyCount(party) === 1, 'convidado não pronto');
    release();

    await waitFor(() => refused.length === 1, 'confirmação recusada');
    expect(refused[0]?.code).toBe('members_not_ready');
    // The refusal is a message; the new revision follows with the next state patch.
    await waitFor(() => party.state.revision > revision, 'revisão nova');
    await eventually(
      async () => (await getActiveExpedition(api.db, leader.id)) === null,
      'expedição desfeita',
    );
    // The party can confirm again on the new revision.
    gate = null;
    await h.readyAll(party, guestRoom);
    await h.confirm(party);
    expect((await getActiveExpedition(api.db, leader.id))?.expeditionId).toBe(
      party.state.expeditionId,
    );
  });

  it('cancels at the deadline what a start with a lost answer created', async () => {
    const leader = await h.player();
    await updateProfileClass(api.db, leader.id, 'class.pilot');
    const pistol = await h.equipPistol(leader);
    // The transaction commits, but its answer never arrives.
    let lose = true;
    const flaky = new Proxy(api.db, {
      get(target, property, receiver) {
        if (property === 'transaction' && lose) {
          lose = false;
          return async (...args: Parameters<typeof target.transaction>) => {
            await target.transaction(...args);
            throw new Error('resposta perdida');
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const service = new ExpeditionService(flaky, { prepareSeconds: 1 });
    try {
      await expect(
        service.start(
          {
            partyKey: randomUUID(),
            leaderAccountId: leader.id,
            shipId: ShipHullId.Scout,
            members: [
              {
                accountId: leader.id,
                classId: 'class.pilot',
                loadout: [{ slot: 'sidearm', instanceId: pistol }],
              },
            ],
          },
          {},
        ),
      ).rejects.toThrow('resposta perdida');
      expect((await getActiveExpedition(api.db, leader.id))?.state).toBe('PREPARING');
      await eventually(
        async () => (await getActiveExpedition(api.db, leader.id)) === null,
        'preparação sem resposta cancelada',
      );
    } finally {
      await service.close();
    }
  });
});
