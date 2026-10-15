import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ItemId, STARTER_PACKAGE, STASH_SLOTS } from '@orbit/catalog';
import { AccountRoute, type InventoryResponse } from '@orbit/contracts';
import { grantItem, grantShipLicense } from '@orbit/database';
import { DEFAULT_IDENTITY_POLICY } from '../src/modules/identity/identity-service';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';

const PASSWORD = 'senha de inventario';

describe('inventory API', () => {
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

  async function signUp() {
    const nick = `Estoque_${++counter}`;
    const response = await call(api.baseUrl, AccountRoute.Accounts, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      body: { nick, password: PASSWORD },
    });
    const body = response.body as { account: { id: string } };
    return { nick, token: response.token ?? '', id: body.account.id };
  }

  const inventory = async (token: string) =>
    (await call(api.baseUrl, AccountRoute.MyInventory, { token })).body as InventoryResponse;

  const move = (token: string, body: unknown) =>
    call(api.baseUrl, AccountRoute.MyStashMove, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      token,
      body,
    });

  it('shows the starter wallet and ship license of a new account', async () => {
    const player = await signUp();
    expect(await inventory(player.token)).toEqual({
      credits: STARTER_PACKAGE.credits,
      stashCapacity: STASH_SLOTS,
      stash: [],
      inbox: [],
      ships: [{ shipId: 'ship.scout' }],
    });
  });

  it('lists ship licenses in catalog order, the starter ship first', async () => {
    const player = await signUp();
    await grantShipLicense(api.db, player.id, 'ship.hauler', 'grant:test');
    expect((await inventory(player.token)).ships).toEqual([
      { shipId: 'ship.scout' },
      { shipId: 'ship.hauler' },
    ]);
  });

  it('keeps stash, credits and licenses across logout and login', async () => {
    const player = await signUp();
    await grantItem(api.db, {
      accountId: player.id,
      itemId: ItemId.Medkit,
      quantity: 7,
      origin: 'grant:test',
      reason: 'teste',
    });
    const before = await inventory(player.token);
    await call(api.baseUrl, AccountRoute.CurrentSession, {
      method: 'DELETE',
      origin: ALLOWED_ORIGIN,
      token: player.token,
    });
    const login = await call(api.baseUrl, AccountRoute.Sessions, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      body: { nick: player.nick, password: PASSWORD },
    });
    expect(await inventory(login.token ?? '')).toEqual(before);
    expect(before.stash.map((entry) => entry.quantity)).toEqual([5, 2]);
  });

  it('never shows or moves items of another account', async () => {
    const owner = await signUp();
    const other = await signUp();
    await grantItem(api.db, {
      accountId: owner.id,
      itemId: ItemId.LongRifle,
      quantity: 1,
      origin: 'grant:test',
      reason: 'teste',
    });
    expect((await inventory(other.token)).stash).toEqual([]);
    expect(await move(other.token, { fromSlot: 0, toSlot: 1 })).toMatchObject({
      status: 409,
      body: { error: 'empty_slot' },
    });
    // The account comes from the session; the body cannot name one.
    expect(await move(other.token, { fromSlot: 0, toSlot: 1, accountId: owner.id })).toMatchObject({
      status: 400,
    });
    expect((await inventory(owner.token)).stash.map((entry) => entry.slot)).toEqual([0]);
  });

  it('moves items within the own stash and validates slots', async () => {
    const player = await signUp();
    await grantItem(api.db, {
      accountId: player.id,
      itemId: ItemId.Pistol,
      quantity: 1,
      origin: 'grant:test',
      reason: 'teste',
    });
    expect((await move(player.token, { fromSlot: 0, toSlot: 7 })).status).toBe(204);
    expect((await inventory(player.token)).stash.map((entry) => entry.slot)).toEqual([7]);
    expect(await move(player.token, { fromSlot: 7, toSlot: STASH_SLOTS })).toMatchObject({
      status: 400,
      body: { error: 'invalid_slot' },
    });
    expect(await move(player.token, { fromSlot: -1, toSlot: 2 })).toMatchObject({ status: 400 });
    expect((await call(api.baseUrl, AccountRoute.MyInventory)).status).toBe(401);
  });
});
