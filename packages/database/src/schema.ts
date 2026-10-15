import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Installation metadata (schema baseline, catalog version in use). Account,
 * inventory and economy tables arrive with their milestones, starting in 0.2.
 */
export const appMetadata = pgTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
