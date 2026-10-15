import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { ITEMS, STARTER_PACKAGE, STASH_SLOTS, isItemId } from '@orbit/catalog';
import type { Database } from '../client';
import {
  accounts,
  inboxEntries,
  inventorySlots,
  itemInstances,
  shipUnlocks,
  wallets,
} from '../schema';

/** Works with the database or an open transaction. */
export type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** Largest quantity accepted in one grant (bounds the work done under the account lock). */
export const MAX_GRANT_QUANTITY = 10_000;

/** Wallet and ship license every new account receives, in the sign-up transaction. */
export async function grantStarterPackage(tx: Executor, accountId: string): Promise<void> {
  await tx.insert(wallets).values({ accountId, credits: STARTER_PACKAGE.credits });
  await tx
    .insert(shipUnlocks)
    .values(
      STARTER_PACKAGE.ships.map((shipId) => ({ accountId, shipId, source: 'grant:starter' })),
    );
}

/** Ship licenses of one account, by catalog ID. */
export async function getShipLicenses(db: Database, accountId: string): Promise<string[]> {
  const rows = await db
    .select({ shipId: shipUnlocks.shipId })
    .from(shipUnlocks)
    .where(eq(shipUnlocks.accountId, accountId))
    .orderBy(asc(shipUnlocks.shipId));
  return rows.map((row) => row.shipId);
}

/** Grants a ship license; granting one the account already has changes nothing. */
export async function grantShipLicense(
  db: Database,
  accountId: string,
  shipId: string,
  source: string,
): Promise<void> {
  await db.insert(shipUnlocks).values({ accountId, shipId, source }).onConflictDoNothing();
}

export interface StashEntry {
  readonly slot: number;
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly durability: number | null;
}

export interface InboxEntry {
  readonly entryId: string;
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly reason: string;
  readonly receivedAt: Date;
}

export interface Inventory {
  readonly credits: number;
  readonly stash: readonly StashEntry[];
  readonly inbox: readonly InboxEntry[];
  readonly ships: readonly { readonly shipId: string; readonly source: string }[];
}

/**
 * Everything the account owns, read on one connection from one snapshot (no grant
 * can land between the wallet and the stash). Every query is filtered by the account.
 */
export async function getInventory(db: Database, accountId: string): Promise<Inventory> {
  return db.transaction(
    async (tx) => {
      const wallet = await tx
        .select({ credits: wallets.credits })
        .from(wallets)
        .where(eq(wallets.accountId, accountId));
      const stash = await tx
        .select({
          slot: inventorySlots.slot,
          instanceId: itemInstances.id,
          itemId: itemInstances.itemId,
          quantity: itemInstances.quantity,
          durability: itemInstances.durability,
        })
        .from(inventorySlots)
        .innerJoin(itemInstances, eq(itemInstances.id, inventorySlots.itemInstanceId))
        .where(eq(inventorySlots.accountId, accountId))
        .orderBy(asc(inventorySlots.slot));
      const inbox = await tx
        .select({
          entryId: inboxEntries.id,
          instanceId: itemInstances.id,
          itemId: itemInstances.itemId,
          quantity: itemInstances.quantity,
          reason: inboxEntries.reason,
          receivedAt: inboxEntries.createdAt,
        })
        .from(inboxEntries)
        .innerJoin(itemInstances, eq(itemInstances.id, inboxEntries.itemInstanceId))
        .where(eq(inboxEntries.accountId, accountId))
        .orderBy(asc(inboxEntries.createdAt));
      const ships = await tx
        .select({ shipId: shipUnlocks.shipId, source: shipUnlocks.source })
        .from(shipUnlocks)
        .where(eq(shipUnlocks.accountId, accountId))
        .orderBy(asc(shipUnlocks.shipId));
      return { credits: wallet[0]?.credits ?? 0, stash, inbox, ships };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/**
 * Serializes inventory changes of one account. FOR NO KEY UPDATE does not conflict
 * with the key-share locks taken by inserts referencing the account (logins).
 */
export async function lockAccount(tx: Executor, accountId: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`SELECT 1 FROM ${accounts} WHERE ${accounts.id} = ${accountId} FOR NO KEY UPDATE`,
  );
  return rows.rowCount === 1;
}

export interface GrantItem {
  readonly accountId: string;
  readonly itemId: string;
  readonly quantity: number;
  /** Provenance of the instances created. */
  readonly origin: string;
  /** Why it was received, shown when it lands in the inbox. */
  readonly reason: string;
}

export interface GrantResult {
  readonly toStash: number;
  readonly toInbox: number;
}

/**
 * Adds items to the account: first tops up existing partial stacks of the same item
 * in the stash, then opens new stacks of at most `maxStack` in free slots, and puts
 * what does not fit in the inbox. Nothing granted is ever discarded. Units added to an
 * existing stack keep that stack's origin; the economy ledger (0.3) records each grant.
 */
export async function grantItem(db: Database, grant: GrantItem): Promise<GrantResult> {
  if (!isItemId(grant.itemId)) throw new RangeError(`Item fora do catálogo: ${grant.itemId}`);
  if (
    !Number.isInteger(grant.quantity) ||
    grant.quantity <= 0 ||
    grant.quantity > MAX_GRANT_QUANTITY
  ) {
    throw new RangeError(`Quantidade precisa ser inteira entre 1 e ${MAX_GRANT_QUANTITY}`);
  }
  const { maxStack } = ITEMS[grant.itemId];
  return db.transaction(async (tx) => {
    if (!(await lockAccount(tx, grant.accountId))) throw new Error('Conta inexistente');
    let remaining = grant.quantity;
    let toStash = 0;

    if (maxStack > 1) {
      const partial = await tx
        .select({ id: itemInstances.id, quantity: itemInstances.quantity })
        .from(itemInstances)
        .innerJoin(inventorySlots, eq(inventorySlots.itemInstanceId, itemInstances.id))
        .where(
          and(
            eq(itemInstances.ownerAccountId, grant.accountId),
            eq(itemInstances.itemId, grant.itemId),
            lt(itemInstances.quantity, maxStack),
          ),
        )
        .orderBy(asc(inventorySlots.slot));
      for (const stack of partial) {
        if (remaining === 0) break;
        const added = Math.min(remaining, maxStack - stack.quantity);
        await tx
          .update(itemInstances)
          .set({ quantity: stack.quantity + added })
          .where(eq(itemInstances.id, stack.id));
        remaining -= added;
        toStash += added;
      }
    }
    if (remaining === 0) return { toStash, toInbox: 0 };

    const used = await tx
      .select({ slot: inventorySlots.slot })
      .from(inventorySlots)
      .where(eq(inventorySlots.accountId, grant.accountId));
    const taken = new Set(used.map((row) => row.slot));
    const free: number[] = [];
    for (let slot = 0; slot < STASH_SLOTS; slot++) if (!taken.has(slot)) free.push(slot);

    // New stacks, inserted in batches. IDs are generated here so slot and inbox rows
    // can reference them without relying on RETURNING order.
    const stacks: { id: string; quantity: number; slot: number | undefined }[] = [];
    while (remaining > 0) {
      const quantity = Math.min(remaining, maxStack);
      remaining -= quantity;
      stacks.push({ id: randomUUID(), quantity, slot: free.shift() });
    }
    await tx.insert(itemInstances).values(
      stacks.map((stack) => ({
        id: stack.id,
        itemId: grant.itemId,
        ownerAccountId: grant.accountId,
        quantity: stack.quantity,
        origin: grant.origin,
        location: stack.slot === undefined ? 'inbox' : 'stash',
      })),
    );
    const slotted = stacks.filter((stack) => stack.slot !== undefined);
    const overflow = stacks.filter((stack) => stack.slot === undefined);
    if (slotted.length > 0) {
      await tx.insert(inventorySlots).values(
        slotted.map((stack) => ({
          accountId: grant.accountId,
          slot: stack.slot ?? 0,
          itemInstanceId: stack.id,
        })),
      );
    }
    if (overflow.length > 0) {
      await tx.insert(inboxEntries).values(
        overflow.map((stack) => ({
          accountId: grant.accountId,
          itemInstanceId: stack.id,
          reason: grant.reason,
        })),
      );
    }
    const sum = (list: typeof stacks) => list.reduce((total, stack) => total + stack.quantity, 0);
    return { toStash: toStash + sum(slotted), toInbox: sum(overflow) };
  });
}

export type MoveResult =
  'moved' | 'swapped' | 'unchanged' | 'empty_slot' | 'invalid_slot' | 'no_account';

/**
 * Moves an item to another slot of the same account's stash, swapping if the target
 * is occupied. Only rows of `accountId` are read or written.
 */
export async function moveStashItem(
  db: Database,
  accountId: string,
  fromSlot: number,
  toSlot: number,
): Promise<MoveResult> {
  const valid = (slot: number) => Number.isInteger(slot) && slot >= 0 && slot < STASH_SLOTS;
  if (!valid(fromSlot) || !valid(toSlot)) return 'invalid_slot';
  return db.transaction(async (tx) => {
    if (!(await lockAccount(tx, accountId))) return 'no_account';
    const rows = await tx
      .select({ slot: inventorySlots.slot, itemInstanceId: inventorySlots.itemInstanceId })
      .from(inventorySlots)
      .where(
        and(
          eq(inventorySlots.accountId, accountId),
          inArray(inventorySlots.slot, [fromSlot, toSlot]),
        ),
      );
    const source = rows.find((row) => row.slot === fromSlot);
    if (!source) return 'empty_slot';
    // Dropping an item back on its own slot is valid and changes nothing.
    if (fromSlot === toSlot) return 'unchanged';
    const target = rows.find((row) => row.slot === toSlot);
    // Both rows are rewritten; the primary key (account, slot) forbids a direct swap.
    await tx
      .delete(inventorySlots)
      .where(
        and(
          eq(inventorySlots.accountId, accountId),
          inArray(inventorySlots.slot, [fromSlot, toSlot]),
        ),
      );
    await tx
      .insert(inventorySlots)
      .values([
        { accountId, slot: toSlot, itemInstanceId: source.itemInstanceId },
        ...(target ? [{ accountId, slot: fromSlot, itemInstanceId: target.itemInstanceId }] : []),
      ]);
    return target ? 'swapped' : 'moved';
  });
}
