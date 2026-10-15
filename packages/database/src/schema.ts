import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Installation metadata (schema baseline, catalog version in use). Account,
 * inventory and economy tables arrive with their milestones, starting in 0.2.
 */
export const appMetadata = pgTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
/** Refreshed by Drizzle on every update issued through the repositories. */
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

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
    index('sessions_active_by_account_idx')
      .on(table.accountId)
      .where(sql`${table.revokedAt} IS NULL`),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('profiles_color_id_format', sql`${table.colorId} ~ '^appearance\\.color\\.[a-z]+$'`),
  ],
);
