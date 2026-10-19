import { sql } from 'drizzle-orm';
import { LOADOUT_SLOTS } from '@orbit/catalog';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Installation metadata (schema baseline, catalog version in use). Account,
 * inventory and economy tables arrive with their milestones, starting in 0.2.
 */
export const appMetadata = pgTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Constant values as a SQL list for IN checks, e.g. `'a', 'b'`. */
const quoted = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
/** Refreshed by a BEFORE UPDATE trigger (migration 0002), using the database clock. */
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Player accounts. The nick is shown as typed and compared case-insensitively
 * through `nick_normalized`. Only Argon2id hashes are stored, never passwords.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nick: text('nick').notNull(),
    nickNormalized: text('nick_normalized').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('accounts_nick_normalized_key').on(table.nickNormalized),
    check('accounts_nick_format', sql`${table.nick} ~ '^[A-Za-z0-9_]{3,20}$'`),
    check('accounts_nick_normalized_matches', sql`${table.nickNormalized} = lower(${table.nick})`),
    check('accounts_password_hash_argon2id', sql`${table.passwordHash} LIKE '$argon2id$%'`),
    check('accounts_status_known', sql`${table.status} IN ('active', 'disabled')`),
  ],
);

/**
 * Login sessions. The browser keeps a random token in an HttpOnly cookie; only
 * its SHA-256 (hex) is stored, so a database leak does not reveal live tokens.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    // Plain index: also serves cascades and FK checks over revoked sessions.
    index('sessions_account_id_idx').on(table.accountId),
    check('sessions_token_hash_sha256_hex', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('sessions_expires_after_creation', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

/**
 * Optional recovery codes, shown once to the player. Single use: `used_at` is
 * set on redemption, and an account has at most one unused code.
 */
export const accountRecovery = pgTable(
  'account_recovery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    createdAt: createdAt(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('account_recovery_one_unused_per_account')
      .on(table.accountId)
      .where(sql`${table.usedAt} IS NULL`),
    index('account_recovery_account_id_idx').on(table.accountId),
    check('account_recovery_code_hash_sha256_hex', sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** Public profile. Appearance values are catalog IDs validated by the server. */
export const profiles = pgTable(
  'profiles',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    colorId: text('color_id').notNull(),
    /** Class chosen for the next mission; null until the player picks one. */
    classId: text('class_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('profiles_color_id_format', sql`${table.colorId} ~ '^appearance\\.color\\.[a-z]+$'`),
    check('profiles_class_id_format', sql`${table.classId} ~ '^class\\.[a-z]+$'`),
  ],
);

/** Credits of an account. Integer, never negative. */
export const wallets = pgTable(
  'wallets',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    credits: bigint('credits', { mode: 'number' }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [check('wallets_credits_not_negative', sql`${table.credits} >= 0`)],
);

/**
 * Every owned item, unique or a stack. `location` says where it is; the slot and
 * inbox tables point to it through composite keys that include owner and location,
 * so an item can only sit in its owner's stash or inbox, and in one place at a time.
 */
export const itemInstances = pgTable(
  'item_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: text('item_id').notNull(),
    ownerAccountId: uuid('owner_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    /** Wear for future equipment; null for items without durability. */
    durability: integer('durability'),
    /** Provenance, e.g. `grant:starter`, `grant:dev`, later `expedition:<id>`. */
    origin: text('origin').notNull(),
    location: text('location').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique('item_instances_id_owner_location').on(table.id, table.ownerAccountId, table.location),
    // Target of item_reservations: a reserved stack cannot change quantity or place.
    unique('item_instances_id_owner_location_quantity').on(
      table.id,
      table.ownerAccountId,
      table.location,
      table.quantity,
    ),
    index('item_instances_owner_idx').on(table.ownerAccountId),
    check('item_instances_item_id_format', sql`${table.itemId} ~ '^item\\.[a-z0-9_.]+$'`),
    check('item_instances_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'item_instances_durability_range',
      sql`${table.durability} IS NULL OR ${table.durability} BETWEEN 0 AND 100`,
    ),
    check('item_instances_location_known', sql`${table.location} IN ('stash', 'inbox')`),
  ],
);

/** Stash positions. One item per slot and one slot per item. */
export const inventorySlots = pgTable(
  'inventory_slots',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    itemInstanceId: uuid('item_instance_id').notNull(),
    location: text('location').notNull().default('stash'),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.slot] }),
    uniqueIndex('inventory_slots_item_key').on(table.itemInstanceId),
    foreignKey({
      name: 'inventory_slots_item_owned_in_stash',
      columns: [table.itemInstanceId, table.accountId, table.location],
      foreignColumns: [itemInstances.id, itemInstances.ownerAccountId, itemInstances.location],
    }).onDelete('cascade'),
    check('inventory_slots_slot_range', sql`${table.slot} >= 0`),
    check('inventory_slots_location_stash', sql`${table.location} = 'stash'`),
  ],
);

/** Items received without room in the stash. Nothing confirmed is ever discarded. */
export const inboxEntries = pgTable(
  'inbox_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    itemInstanceId: uuid('item_instance_id').notNull(),
    location: text('location').notNull().default('inbox'),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('inbox_entries_item_key').on(table.itemInstanceId),
    index('inbox_entries_account_idx').on(table.accountId),
    foreignKey({
      name: 'inbox_entries_item_owned_in_inbox',
      columns: [table.itemInstanceId, table.accountId, table.location],
      foreignColumns: [itemInstances.id, itemInstances.ownerAccountId, itemInstances.location],
    }).onDelete('cascade'),
    check('inbox_entries_location_inbox', sql`${table.location} = 'inbox'`),
  ],
);

/**
 * Items picked for the next mission. The item stays in its owner's stash (the
 * composite key requires it): picking changes nothing in the stash, and the match
 * reservation arrives in 0.3. An item cannot leave the stash while picked, and
 * deleting it removes it from the loadout.
 */
export const loadoutItems = pgTable(
  'loadout_items',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** One of LOADOUT_SLOTS: `primary`, `sidearm`, `tool` or `backpack.<n>`. */
    slot: text('slot').notNull(),
    itemInstanceId: uuid('item_instance_id').notNull(),
    location: text('location').notNull().default('stash'),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.slot] }),
    uniqueIndex('loadout_items_item_key').on(table.itemInstanceId),
    foreignKey({
      name: 'loadout_items_item_owned_in_stash',
      columns: [table.itemInstanceId, table.accountId, table.location],
      foreignColumns: [itemInstances.id, itemInstances.ownerAccountId, itemInstances.location],
    }).onDelete('cascade'),
    // Derived from the catalog: changing the slots shows up as schema drift.
    check('loadout_items_slot_known', sql`${table.slot} IN (${quoted(LOADOUT_SLOTS)})`),
    check('loadout_items_location_stash', sql`${table.location} = 'stash'`),
  ],
);

/** Ship licenses. Not consumed or lost when a ship is destroyed (D04). */
export const shipUnlocks = pgTable(
  'ship_unlocks',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    shipId: text('ship_id').notNull(),
    source: text('source').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.shipId] }),
    check('ship_unlocks_ship_id_format', sql`${table.shipId} ~ '^ship\\.[a-z0-9_]+$'`),
  ],
);

/** Lifecycle of an expedition (docs/05). Terminal states have `ended_at`. */
export const EXPEDITION_STATES = [
  'PREPARING',
  'ACTIVE',
  'EXTRACTING',
  'SETTLING',
  'CLOSED',
  'CANCELLED',
  'FAILED',
  'ABORTED_TECHNICAL',
] as const;
export type ExpeditionState = (typeof EXPEDITION_STATES)[number];
export const TERMINAL_EXPEDITION_STATES = [
  'CLOSED',
  'CANCELLED',
  'FAILED',
  'ABORTED_TECHNICAL',
] as const satisfies readonly ExpeditionState[];

/**
 * One match of one party. Created in PREPARING by the leader's confirmation; the
 * `start_key` makes a retried confirmation return the same expedition, and
 * `request_hash` tells a retry apart from a different request reusing the key.
 */
export const expeditions = pgTable(
  'expeditions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    state: text('state').notNull().default('PREPARING'),
    startKey: text('start_key').notNull(),
    requestHash: text('request_hash').notNull(),
    /** Restrict: deleting the leader must not erase the other members' history. */
    leaderAccountId: uuid('leader_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    shipId: text('ship_id').notNull(),
    catalogVersion: integer('catalog_version').notNull(),
    /** A PREPARING expedition past this moment is cancelled and its items returned. */
    prepareDeadlineAt: timestamp('prepare_deadline_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('expeditions_start_key_key').on(table.startKey),
    check('expeditions_state_known', sql`${table.state} IN (${quoted(EXPEDITION_STATES)})`),
    check(
      'expeditions_ended_when_terminal',
      sql`(${table.state} IN (${quoted(TERMINAL_EXPEDITION_STATES)})) = (${table.endedAt} IS NOT NULL)`,
    ),
    check('expeditions_start_key_length', sql`length(${table.startKey}) BETWEEN 1 AND 200`),
    check('expeditions_request_hash_sha256_hex', sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check('expeditions_ship_id_format', sql`${table.shipId} ~ '^ship\\.[a-z0-9_]+$'`),
  ],
);

/** A player in an expedition, with the class and loadout frozen when it was created. */
export const expeditionMembers = pgTable(
  'expedition_members',
  {
    expeditionId: uuid('expedition_id')
      .notNull()
      .references(() => expeditions.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    classId: text('class_id').notNull(),
    /** Snapshot of the reserved loadout: `[{ slot, instanceId, itemId, quantity }]`. */
    loadout: jsonb('loadout').notNull(),
    /** Outcome for this member, set by the settlement (V03.07). */
    finalState: text('final_state'),
  },
  (table) => [
    primaryKey({ columns: [table.expeditionId, table.accountId] }),
    index('expedition_members_account_idx').on(table.accountId),
    check('expedition_members_class_id_format', sql`${table.classId} ~ '^class\\.[a-z]+$'`),
    check(
      'expedition_members_final_state_known',
      sql`${table.finalState} IS NULL OR ${table.finalState} IN ('extracted', 'not_eligible', 'destroyed', 'timeout')`,
    ),
  ],
);

/**
 * The expedition an account is in right now. The primary key on the account makes a
 * second simultaneous expedition impossible; the row goes away when it ends.
 */
export const activeParticipations = pgTable(
  'active_participations',
  {
    accountId: uuid('account_id').primaryKey(),
    expeditionId: uuid('expedition_id').notNull(),
  },
  (table) => [
    unique('active_participations_account_expedition').on(table.accountId, table.expeditionId),
    index('active_participations_expedition_idx').on(table.expeditionId),
    foreignKey({
      name: 'active_participations_member',
      columns: [table.expeditionId, table.accountId],
      foreignColumns: [expeditionMembers.expeditionId, expeditionMembers.accountId],
    }).onDelete('cascade'),
  ],
);

/**
 * Items taken to an expedition. The primary key on the item reserves it at most once;
 * the whole stack must be in its owner's stash and stays as it was while reserved, and
 * a reservation cannot outlive its owner's active participation.
 */
export const itemReservations = pgTable(
  'item_reservations',
  {
    itemInstanceId: uuid('item_instance_id').primaryKey(),
    expeditionId: uuid('expedition_id').notNull(),
    accountId: uuid('account_id').notNull(),
    slot: text('slot').notNull(),
    /** The whole stack is taken; it must match the instance (see the foreign key). */
    quantity: integer('quantity').notNull(),
    location: text('location').notNull().default('stash'),
  },
  (table) => [
    unique('item_reservations_member_slot').on(table.expeditionId, table.accountId, table.slot),
    index('item_reservations_participation_idx').on(table.accountId, table.expeditionId),
    // Includes the quantity: while reserved, the stack cannot be deleted, moved out of
    // the stash or change size, whatever code tries it.
    foreignKey({
      name: 'item_reservations_item_owned_in_stash',
      columns: [table.itemInstanceId, table.accountId, table.location, table.quantity],
      foreignColumns: [
        itemInstances.id,
        itemInstances.ownerAccountId,
        itemInstances.location,
        itemInstances.quantity,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'item_reservations_participation',
      columns: [table.accountId, table.expeditionId],
      foreignColumns: [activeParticipations.accountId, activeParticipations.expeditionId],
    }).onDelete('restrict'),
    check('item_reservations_slot_known', sql`${table.slot} IN (${quoted(LOADOUT_SLOTS)})`),
    check('item_reservations_quantity_positive', sql`${table.quantity} > 0`),
    check('item_reservations_location_stash', sql`${table.location} = 'stash'`),
  ],
);

export const SETTLEMENT_OUTCOMES = ['extracted', 'destroyed', 'timeout'] as const;

/**
 * One liquidation per expedition (primary key), written once by `settleExpedition`
 * (V03.07). `manifest` is the immutable record built by
 * `apps/server/src/modules/settlement/manifest.ts`; `manifest_hash` lets a retry tell a
 * repeat of the same proposal from a conflicting one without comparing the whole JSON.
 */
export const settlements = pgTable(
  'settlements',
  {
    expeditionId: uuid('expedition_id')
      .primaryKey()
      .references(() => expeditions.id, { onDelete: 'restrict' }),
    outcome: text('outcome').notNull(),
    manifest: jsonb('manifest').notNull(),
    manifestHash: text('manifest_hash').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check('settlements_outcome_known', sql`${table.outcome} IN (${quoted(SETTLEMENT_OUTCOMES)})`),
    check('settlements_manifest_hash_sha256_hex', sql`${table.manifestHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
