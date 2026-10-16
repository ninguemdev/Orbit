import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassId, DEFAULT_APPEARANCE_COLOR, ItemId, ShipHullId } from '@orbit/catalog';
import { postgresError } from '../src/client';
import {
  type StartExpeditionRequest,
  cancelPreparation,
  getActiveExpedition,
  startExpedition,
} from '../src/expedition/expeditions';
import { createAccount } from '../src/identity/accounts';
import { updateProfileClass } from '../src/identity/sessions';
import { getInventory, grantItem, grantShipLicense } from '../src/inventory/inventory';
import { type LoadoutPick, setLoadout } from '../src/inventory/loadout';
import { FAKE_ARGON2ID_HASH, type TestDatabase, createTestDatabase } from './test-database';

describe('expedition start and reservations', () => {
  let t: TestDatabase;
  let counter = 0;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.drop();
  });

  interface Player {
    readonly accountId: string;
    readonly classId: string;
    readonly loadout: LoadoutPick[];
  }

  /** An account with a class, items in the stash and a saved loadout. */
  async function newPlayer(
    classId: string = ClassId.Engineer,
    items: readonly [slot: string, itemId: string, quantity?: number][] = [
      ['sidearm', ItemId.Pistol],
      ['backpack.0', ItemId.Medkit, 3],
    ],
  ): Promise<Player> {
    const created = await createAccount(t.db, {
      nick: `Exped_${++counter}`,
      passwordHash: FAKE_ARGON2ID_HASH,
      colorId: DEFAULT_APPEARANCE_COLOR,
    });
    if (!created.ok) throw new Error('conta não criada');
    const { accountId } = created;
    await updateProfileClass(t.db, accountId, classId);
    const loadout: LoadoutPick[] = [];
    for (const [slot, itemId, quantity = 1] of items) {
      const before = new Set((await getInventory(t.db, accountId)).stash.map((e) => e.instanceId));
      await grantItem(t.db, { accountId, itemId, quantity, origin: 'grant:test', reason: 'teste' });
      const added = (await getInventory(t.db, accountId)).stash.find(
        (entry) => !before.has(entry.instanceId),
      );
      if (!added) throw new Error('item não concedido');
      loadout.push({ slot, instanceId: added.instanceId });
    }
    expect(await setLoadout(t.db, accountId, loadout)).toEqual({ ok: true });
    return { accountId, classId, loadout };
  }

  function request(players: readonly Player[], startKey = randomUUID()): StartExpeditionRequest {
    return {
      startKey,
      leaderAccountId: players[0]?.accountId ?? '',
      shipId: ShipHullId.Scout,
      members: players.map(({ accountId, classId, loadout }) => ({ accountId, classId, loadout })),
    };
  }

  async function count(table: string, expeditionId: string): Promise<number> {
    const column = table === 'expeditions' ? 'id' : 'expedition_id';
    const result = await t.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE ${column} = $1`,
      [expeditionId],
    );
    return Number(result.rows[0]?.n);
  }

  async function expeditionsOf(accountId: string): Promise<number> {
    const result = await t.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM expedition_members WHERE account_id = $1',
      [accountId],
    );
    return Number(result.rows[0]?.n);
  }

  it('creates a PREPARING expedition and reserves every member loadout', async () => {
    const alpha = await newPlayer(ClassId.Officer, [
      ['primary', ItemId.LongRifle],
      ['sidearm', ItemId.Pistol],
    ]);
    const bravo = await newPlayer(ClassId.Engineer, [
      ['tool', ItemId.RepairKit],
      ['backpack.0', ItemId.Medkit, 3],
    ]);
    const stashBefore = (await getInventory(t.db, bravo.accountId)).stash;

    const result = await startExpedition(t.db, request([alpha, bravo]));
    if (!result.ok) throw new Error(result.reason);
    expect(result.state).toBe('PREPARING');
    expect(result.created).toBe(true);
    expect(result.prepareDeadlineAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    const active = await getActiveExpedition(t.db, bravo.accountId);
    expect(active?.expeditionId).toBe(result.expeditionId);
    expect(active?.reserved.map((item) => [item.slot, item.itemId, item.quantity])).toEqual([
      ['tool', ItemId.RepairKit, 1],
      ['backpack.0', ItemId.Medkit, 3],
    ]);
    expect(await count('item_reservations', result.expeditionId)).toBe(4);
    // Reserved items stay in the stash, where they are only marked unavailable.
    const withoutFlag = (stash: typeof stashBefore) =>
      stash.map(({ reserved: _, ...entry }) => entry);
    const stashAfter = (await getInventory(t.db, bravo.accountId)).stash;
    expect(withoutFlag(stashAfter)).toEqual(withoutFlag(stashBefore));
    expect(stashBefore.map((entry) => entry.reserved)).toEqual([false, false]);
    expect(stashAfter.map((entry) => entry.reserved)).toEqual([true, true]);

    // The snapshot records exactly what each member took.
    const snapshot = await t.pool.query<{ class_id: string; loadout: unknown }>(
      'SELECT class_id, loadout FROM expedition_members WHERE expedition_id = $1 AND account_id = $2',
      [result.expeditionId, alpha.accountId],
    );
    expect(snapshot.rows[0]?.class_id).toBe(ClassId.Officer);
    expect(snapshot.rows[0]?.loadout).toEqual([
      {
        slot: 'primary',
        instanceId: alpha.loadout[0]?.instanceId,
        itemId: ItemId.LongRifle,
        quantity: 1,
      },
      {
        slot: 'sidearm',
        instanceId: alpha.loadout[1]?.instanceId,
        itemId: ItemId.Pistol,
        quantity: 1,
      },
    ]);
  });

  it('answers a retry with the same expedition and refuses the key for another request', async () => {
    const alpha = await newPlayer();
    const bravo = await newPlayer();
    const first = request([alpha, bravo]);

    const created = await startExpedition(t.db, first);
    if (!created.ok) throw new Error(created.reason);
    // Members listed in another order are the same request.
    const retried = await startExpedition(t.db, {
      ...first,
      members: [...first.members].reverse(),
    });
    expect(retried).toEqual({ ...created, created: false });
    expect(await count('expedition_members', created.expeditionId)).toBe(2);
    expect(await count('item_reservations', created.expeditionId)).toBe(4);

    const other = await newPlayer();
    expect(await startExpedition(t.db, { ...request([other]), startKey: first.startKey })).toEqual({
      ok: false,
      reason: 'key_reused',
      accountIds: [],
    });
    expect(await getActiveExpedition(t.db, other.accountId)).toBeNull();
  });

  it('keeps an account out of a second expedition, even when both start at once', async () => {
    const shared = await newPlayer();
    const left = await newPlayer();
    const right = await newPlayer();

    const results = await Promise.all([
      startExpedition(t.db, request([left, shared])),
      startExpedition(t.db, request([right, shared])),
    ]);
    const started = results.filter((result) => result.ok);
    const refused = results.filter((result) => !result.ok);
    expect(started).toHaveLength(1);
    expect(refused).toEqual([
      { ok: false, reason: 'already_in_expedition', accountIds: [shared.accountId] },
    ]);
    expect(await expeditionsOf(shared.accountId)).toBe(1);
    // The refused start recorded nothing for its other member.
    const loser = results[0]?.ok ? right : left;
    expect(await getActiveExpedition(t.db, loser.accountId)).toBeNull();
    expect(await expeditionsOf(loser.accountId)).toBe(0);
  });

  it('creates one expedition when the same confirmation arrives twice at once', async () => {
    const alpha = await newPlayer();
    const bravo = await newPlayer();
    const same = request([alpha, bravo]);

    const results = await Promise.all([startExpedition(t.db, same), startExpedition(t.db, same)]);
    const ids = results.map((result) => (result.ok ? result.expeditionId : result.reason));
    expect(new Set(ids).size).toBe(1);
    expect(results.filter((result) => result.ok && result.created)).toHaveLength(1);
    expect(await expeditionsOf(alpha.accountId)).toBe(1);
  });

  it('records nothing when a write fails halfway through', async () => {
    const alpha = await newPlayer();
    const bravo = await newPlayer();
    // Injected failure: the second member's reservation cannot be written.
    await t.pool.query(`
      CREATE FUNCTION fail_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.account_id = '${bravo.accountId}' THEN RAISE EXCEPTION 'falha injetada'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fail_reservation BEFORE INSERT ON item_reservations
      FOR EACH ROW EXECUTE FUNCTION fail_reservation();
    `);
    try {
      await expect(startExpedition(t.db, request([alpha, bravo]))).rejects.toThrow();
    } finally {
      await t.pool.query(
        'DROP TRIGGER fail_reservation ON item_reservations; DROP FUNCTION fail_reservation();',
      );
    }
    for (const player of [alpha, bravo]) {
      expect(await getActiveExpedition(t.db, player.accountId)).toBeNull();
      expect(await expeditionsOf(player.accountId)).toBe(0);
    }
    // Nothing is left that blocks a new attempt.
    expect((await startExpedition(t.db, request([alpha, bravo]))).ok).toBe(true);
  });

  it('checks again what the party showed and refuses without reserving anything', async () => {
    const alpha = await newPlayer(ClassId.Officer, [['primary', ItemId.LongRifle]]);
    const bravo = await newPlayer();

    // A class saved after the confirmation.
    await updateProfileClass(t.db, bravo.accountId, ClassId.Medic);
    expect(await startExpedition(t.db, request([alpha, bravo]))).toEqual({
      ok: false,
      reason: 'class_changed',
      accountIds: [bravo.accountId],
    });
    await updateProfileClass(t.db, bravo.accountId, bravo.classId);

    // A loadout saved after the confirmation.
    const [, medkits] = bravo.loadout;
    expect(await setLoadout(t.db, bravo.accountId, medkits ? [medkits] : [])).toEqual({ ok: true });
    expect(await startExpedition(t.db, request([alpha, bravo]))).toEqual({
      ok: false,
      reason: 'loadout_changed',
      accountIds: [bravo.accountId],
    });
    expect(await setLoadout(t.db, bravo.accountId, bravo.loadout)).toEqual({ ok: true });

    // The long rifle stops being valid when the Officer becomes a Pilot.
    await updateProfileClass(t.db, alpha.accountId, ClassId.Pilot);
    expect(
      await startExpedition(t.db, request([{ ...alpha, classId: ClassId.Pilot }, bravo])),
    ).toEqual({ ok: false, reason: 'loadout_invalid', accountIds: [alpha.accountId] });
    await updateProfileClass(t.db, alpha.accountId, alpha.classId);

    // Nobody in the party has the hauler license.
    expect(
      await startExpedition(t.db, { ...request([alpha, bravo]), shipId: ShipHullId.Hauler }),
    ).toEqual({ ok: false, reason: 'ship_unavailable', accountIds: [] });
    // One member's license is enough for the whole party.
    await grantShipLicense(t.db, bravo.accountId, ShipHullId.Hauler, 'grant:test');
    const started = await startExpedition(t.db, {
      ...request([alpha, bravo]),
      shipId: ShipHullId.Hauler,
    });
    expect(started.ok).toBe(true);
    expect(await expeditionsOf(alpha.accountId)).toBe(1);
  });

  it('refuses malformed requests before touching the database', async () => {
    const alpha = await newPlayer();
    const bravo = await newPlayer();
    const base = request([alpha, bravo]);
    const loadout = { classId: alpha.classId, loadout: alpha.loadout };
    const refusals = await Promise.all([
      startExpedition(t.db, { ...base, leaderAccountId: randomUUID() }),
      startExpedition(t.db, { ...base, members: [] }),
      startExpedition(t.db, { ...base, members: [...base.members, ...base.members] }),
      startExpedition(t.db, { ...base, startKey: '' }),
      startExpedition(t.db, { ...base, prepareSeconds: 0 }),
      startExpedition(t.db, { ...base, prepareSeconds: 1e15 }),
      // IDs the database would reject, or read as another member in another case.
      startExpedition(t.db, {
        ...base,
        members: [{ ...loadout, accountId: 'abc' }],
        leaderAccountId: 'abc',
      }),
      startExpedition(t.db, {
        ...base,
        members: [...base.members, { ...loadout, accountId: alpha.accountId.toUpperCase() }],
      }),
    ]);
    for (const refusal of refusals) {
      expect(refusal).toEqual({ ok: false, reason: 'invalid_request', accountIds: [] });
    }
    const ghost = randomUUID();
    expect(
      await startExpedition(t.db, {
        ...base,
        members: [...base.members, { accountId: ghost, classId: ClassId.Pilot, loadout: [] }],
      }),
    ).toEqual({ ok: false, reason: 'no_account', accountIds: [ghost] });
    expect(await expeditionsOf(alpha.accountId)).toBe(0);
  });

  it('cancels a preparation once and makes the items available again', async () => {
    const alpha = await newPlayer();
    const first = request([alpha]);
    const started = await startExpedition(t.db, first);
    if (!started.ok) throw new Error(started.reason);

    expect(await cancelPreparation(t.db, started.expeditionId)).toBe('cancelled');
    expect(await cancelPreparation(t.db, started.expeditionId)).toBe('not_preparing');
    expect(await cancelPreparation(t.db, randomUUID())).toBe('not_found');
    expect(await getActiveExpedition(t.db, alpha.accountId)).toBeNull();
    expect(await count('item_reservations', started.expeditionId)).toBe(0);
    const ended = await t.pool.query<{ state: string; ended_at: Date | null }>(
      'SELECT state, ended_at FROM expeditions WHERE id = $1',
      [started.expeditionId],
    );
    expect(ended.rows[0]?.state).toBe('CANCELLED');
    expect(ended.rows[0]?.ended_at).toBeInstanceOf(Date);

    // A late retry of the old confirmation names the ended expedition and starts nothing.
    expect(await startExpedition(t.db, first)).toEqual({
      ok: false,
      reason: 'expedition_ended',
      expeditionId: started.expeditionId,
      state: 'CANCELLED',
      accountIds: [],
    });
    expect(await getActiveExpedition(t.db, alpha.accountId)).toBeNull();
    // A new confirmation takes the same items again.
    expect((await startExpedition(t.db, request([alpha]))).ok).toBe(true);
  });

  it('does not let a reserved item be deleted, topped up or reserved twice', async () => {
    const alpha = await newPlayer();
    const started = await startExpedition(t.db, request([alpha]));
    if (!started.ok) throw new Error(started.reason);
    const [pistol, medkits] = alpha.loadout;

    const deletion = t.pool.query('DELETE FROM item_instances WHERE id = $1', [pistol?.instanceId]);
    await expect(deletion).rejects.toSatisfy(
      (error: unknown) =>
        postgresError(error)?.constraint === 'item_reservations_item_owned_in_stash',
    );

    // Any change to the reserved stack is refused by the schema, not only by grants.
    const resize = t.pool.query('UPDATE item_instances SET quantity = 1 WHERE id = $1', [
      medkits?.instanceId,
    ]);
    await expect(resize).rejects.toSatisfy(
      (error: unknown) =>
        postgresError(error)?.constraint === 'item_reservations_item_owned_in_stash',
    );

    // New medkits open a stack of their own instead of joining the reserved one.
    await grantItem(t.db, {
      accountId: alpha.accountId,
      itemId: ItemId.Medkit,
      quantity: 2,
      origin: 'grant:test',
      reason: 'teste',
    });
    const stash = (await getInventory(t.db, alpha.accountId)).stash;
    expect(stash.find((entry) => entry.instanceId === medkits?.instanceId)?.quantity).toBe(3);
    expect(stash.filter((entry) => entry.itemId === ItemId.Medkit).map((e) => e.quantity)).toEqual([
      3, 2,
    ]);

    // The schema refuses a second reservation of the item and a reservation
    // without an active participation, whatever code tries it.
    const other = await newPlayer();
    const again = t.pool.query(
      `INSERT INTO item_reservations (item_instance_id, expedition_id, account_id, slot, quantity)
       VALUES ($1, $2, $3, 'sidearm', 1)`,
      [pistol?.instanceId, started.expeditionId, alpha.accountId],
    );
    await expect(again).rejects.toSatisfy(
      (error: unknown) => postgresError(error)?.constraint === 'item_reservations_pkey',
    );
    const orphan = t.pool.query(
      `INSERT INTO item_reservations (item_instance_id, expedition_id, account_id, slot, quantity)
       VALUES ($1, $2, $3, 'sidearm', 1)`,
      [other.loadout[0]?.instanceId, started.expeditionId, other.accountId],
    );
    await expect(orphan).rejects.toSatisfy(
      (error: unknown) => postgresError(error)?.constraint === 'item_reservations_participation',
    );
  });

  it('keeps the reserved loadout fixed until the expedition ends', async () => {
    const alpha = await newPlayer();
    const started = await startExpedition(t.db, request([alpha]));
    if (!started.ok) throw new Error(started.reason);

    expect(await setLoadout(t.db, alpha.accountId, [])).toEqual({
      ok: false,
      issues: null,
      reason: 'in_expedition',
    });
    expect((await getActiveExpedition(t.db, alpha.accountId))?.reserved).toHaveLength(2);

    expect(await cancelPreparation(t.db, started.expeditionId)).toBe('cancelled');
    expect(await setLoadout(t.db, alpha.accountId, [])).toEqual({ ok: true });
  });

  it("keeps the other members' history when an account is deleted", async () => {
    const leader = await newPlayer();
    const member = await newPlayer();
    const started = await startExpedition(t.db, request([leader, member]));
    if (!started.ok) throw new Error(started.reason);
    expect(await cancelPreparation(t.db, started.expeditionId)).toBe('cancelled');

    const dropLeader = t.pool.query('DELETE FROM accounts WHERE id = $1', [leader.accountId]);
    await expect(dropLeader).rejects.toSatisfy(
      (error: unknown) =>
        postgresError(error)?.constraint === 'expeditions_leader_account_id_accounts_id_fk',
    );
    await t.pool.query('DELETE FROM accounts WHERE id = $1', [member.accountId]);
    expect(await count('expeditions', started.expeditionId)).toBe(1);
    expect(await expeditionsOf(leader.accountId)).toBe(1);
  });
});
