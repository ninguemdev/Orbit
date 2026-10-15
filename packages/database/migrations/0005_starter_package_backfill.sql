-- Accounts created before inventories existed receive the starter package that new
-- accounts get at sign-up (STARTER_PACKAGE in @orbit/catalog: 200 credits and the
-- scout ship license). Idempotent: existing rows are left untouched.
INSERT INTO "wallets" ("account_id", "credits")
SELECT "id", 200 FROM "accounts"
ON CONFLICT ("account_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "ship_unlocks" ("account_id", "ship_id", "source")
SELECT "id", 'ship.scout', 'grant:starter' FROM "accounts"
ON CONFLICT ("account_id", "ship_id") DO NOTHING;
