import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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
type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** Wallet and ship license every new account receives, in the sign-up transaction. */
export async function grantStarterPackage(tx: Executor, accountId: string): Promise<void> {
  await tx.insert(wallets).values({ accountId, credits: STARTER_PACKAGE.credits });
  await tx
    .insert(shipUnlocks)
    .values(
      STARTER_PACKAGE.ships.map((shipId) => ({ accountId, shipId, source: 'grant:starter' })),
    );
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

/** Everything the account owns. Every query is filtered by the account itself. */
export async function getInventory(db: Database, accountId: string): Promise<Inventory> {
  const [wallet, stash, inbox, ships] = await Promise.all([
    db.select({ credits: wallets.credits }).from(wallets).where(eq(wallets.accountId, accountId)),
    db
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
      .orderBy(asc(inventorySlots.slot)),
    db
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
      .orderBy(asc(inboxEntries.createdAt)),
    db
      .select({ shipId: shipUnlocks.shipId, source: shipUnlocks.source })
      .from(shipUnlocks)
      .where(eq(shipUnlocks.accountId, accountId))
      .orderBy(asc(shipUnlocks.shipId)),
  ]);
  return { credits: wallet[0]?.credits ?? 0, stash, inbox, ships };
}

/** Serializes inventory changes of one account (stash slots are a shared resource). */
async function lockAccount(tx: Executor, accountId: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`SELECT 1 FROM ${accounts} WHERE ${accounts.id} = ${accountId} FOR UPDATE`,
  );
  return rows.rowCount === 1;
}

export interface GrantItem {
  readonly accountId: string;
  readonly itemId: string;
  readonly quantity: number;
  /** Provenance kept on every instance created. */
  readonly origin: string;
  /** Why it was received, shown when it lands in the inbox. */
  readonly reason: string;
}

export interface GrantResult {
  readonly toStash: number;
  readonly toInbox: number;
}

/**
 * Adds items as stacks of at most `maxStack`, each in the first free stash slot;
 * what does not fit goes to the inbox. Nothing granted is ever discarded.
 */
export async function grantItem(db: Database, grant: GrantItem): Promise<GrantResult> {
  if (!isItemId(grant.itemId)) throw new RangeError(`Item fora do catálogo: ${grant.itemId}`);
  if (!Number.isInteger(grant.quantity) || grant.quantity <= 0) {
    throw new RangeError('Quantidade precisa ser inteira e positiva');
  }
  const { maxStack } = ITEMS[grant.itemId];
  return db.transaction(async (tx) => {
    if (!(await lockAccount(tx, grant.accountId))) throw new Error('Conta inexistente');
    const used = await tx
      .select({ slot: inventorySlots.slot })
      .from(inventorySlots)
      .where(eq(inventorySlots.accountId, grant.accountId));
    const taken = new Set(used.map((row) => row.slot));
    const free: number[] = [];
    for (let slot = 0; slot < STASH_SLOTS; slot++) if (!taken.has(slot)) free.push(slot);

    let remaining = grant.quantity;
    const result = { toStash: 0, toInbox: 0 };
    while (remaining > 0) {
      const quantity = Math.min(remaining, maxStack);
      remaining -= quantity;
      const slot = free.shift();
      const location = slot === undefined ? 'inbox' : 'stash';
      const [instance] = await tx
        .insert(itemInstances)
        .values({
          itemId: grant.itemId,
          ownerAccountId: grant.accountId,
          quantity,
          origin: grant.origin,
          location,
        })
        .returning({ id: itemInstances.id });
      if (!instance) throw new Error('Item não criado');
      if (slot === undefined) {
        await tx.insert(inboxEntries).values({
          accountId: grant.accountId,
          itemInstanceId: instance.id,
          reason: grant.reason,
        });
        result.toInbox += quantity;
      } else {
        await tx
          .insert(inventorySlots)
          .values({ accountId: grant.accountId, slot, itemInstanceId: instance.id });
        result.toStash += quantity;
      }
    }
    return result;
  });
}

export type MoveResult = 'moved' | 'swapped' | 'empty_slot' | 'invalid_slot';

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
  if (!valid(fromSlot) || !valid(toSlot) || fromSlot === toSlot) return 'invalid_slot';
  return db.transaction(async (tx) => {
    if (!(await lockAccount(tx, accountId))) return 'empty_slot';
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
