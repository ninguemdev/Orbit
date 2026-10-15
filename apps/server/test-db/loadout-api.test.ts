import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ItemId } from '@orbit/catalog';
import { AccountRoute, type InventoryResponse, type LoadoutResponse } from '@orbit/contracts';
import { grantItem } from '@orbit/database';
import { DEFAULT_IDENTITY_POLICY } from '../src/modules/identity/identity-service';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';

describe('loadout API', () => {
  let api: ApiServer;
  let counter = 0;

  beforeAll(async () => {
    api = await startApiServer({
      ...DEFAULT_IDENTITY_POLICY,
      loginAttemptsPerAddress: 1000,
      signUpsPerAddress: 1000,
    });
  });

  afterAll(async () => {
    await api?.close();
  });

  async function player(items: readonly string[]) {
    const response = await call(api.baseUrl, AccountRoute.Accounts, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      body: { nick: `Equipa_${++counter}`, password: 'senha de loadout longa' },
    });
    const token = response.token ?? '';
    const id = (response.body as { account: { id: string } }).account.id;
    for (const itemId of items) {
      await grantItem(api.db, {
        accountId: id,
        itemId,
        quantity: 1,
        origin: 'grant:test',
        reason: 'teste',
      });
    }
    const inventory = (await call(api.baseUrl, AccountRoute.MyInventory, { token }))
      .body as InventoryResponse;
    const instance = (itemId: string) =>
      inventory.stash.find((entry) => entry.itemId === itemId)?.instanceId ?? '';
    return { token, instance, inventory };
  }

  const put = (token: string, body: unknown) =>
    call(api.baseUrl, AccountRoute.MyLoadout, {
      method: 'PUT',
      origin: ALLOWED_ORIGIN,
      token,
      body,
    });

  it('saves a valid loadout for the session account and leaves the stash as it was', async () => {
    const me = await player([ItemId.Pistol, ItemId.Medkit]);
    const saved = await put(me.token, {
      picks: [
        { slot: 'sidearm', instanceId: me.instance(ItemId.Pistol) },
        { slot: 'backpack.0', instanceId: me.instance(ItemId.Medkit) },
      ],
    });
    expect(saved.status).toBe(200);
    expect((saved.body as LoadoutResponse).entries.map((entry) => entry.slot)).toEqual([
      'backpack.0',
      'sidearm',
    ]);
    const read = await call(api.baseUrl, AccountRoute.MyLoadout, { token: me.token });
    expect(read.body).toEqual(saved.body);
    expect((await call(api.baseUrl, AccountRoute.MyInventory, { token: me.token })).body).toEqual(
      me.inventory,
    );
  });

  it('refuses forged payloads on the server', async () => {
    const me = await player([ItemId.LongRifle, ItemId.Pistol]);
    const other = await player([ItemId.Pistol]);

    // Weapon for another class, and an item of another account.
    expect(
      await put(me.token, {
        picks: [
          { slot: 'primary', instanceId: me.instance(ItemId.LongRifle) },
          { slot: 'sidearm', instanceId: other.instance(ItemId.Pistol) },
        ],
      }),
    ).toMatchObject({
      status: 422,
      body: {
        error: 'invalid_loadout',
        issues: [
          { slot: 'primary', issue: 'class_restricted' },
          { slot: 'sidearm', issue: 'not_owned' },
        ],
      },
    });
    // Item that does not exist.
    expect(
      await put(me.token, {
        picks: [{ slot: 'backpack.0', instanceId: '00000000-0000-4000-8000-000000000000' }],
      }),
    ).toMatchObject({ status: 422, body: { issues: [{ issue: 'not_owned' }] } });
    // Fields the contract does not have, IDs that are not UUIDs, too many picks.
    for (const body of [
      { picks: [], accountId: 'x' },
      { picks: [{ slot: 'sidearm', instanceId: me.instance(ItemId.Pistol), itemId: 'item.x' }] },
      { picks: [{ slot: 'sidearm', instanceId: 'not-a-uuid' }] },
      {
        picks: Array.from({ length: 12 }, (_, i) => ({
          slot: `backpack.${i}`,
          instanceId: me.instance(ItemId.Pistol),
        })),
      },
    ]) {
      expect(await put(me.token, body)).toMatchObject({
        status: 400,
        body: { error: 'invalid_input' },
      });
    }
    expect((await call(api.baseUrl, AccountRoute.MyLoadout, { token: me.token })).body).toEqual({
      classId: null,
      entries: [],
    });
    expect((await put('', { picks: [] })).status).toBe(401);
    expect((await call(api.baseUrl, AccountRoute.MyLoadout)).status).toBe(401);
  });
});
