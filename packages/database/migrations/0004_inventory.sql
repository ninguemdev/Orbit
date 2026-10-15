CREATE TABLE "inbox_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"item_instance_id" uuid NOT NULL,
	"location" text DEFAULT 'inbox' NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_entries_location_inbox" CHECK ("inbox_entries"."location" = 'inbox')
);
--> statement-breakpoint
CREATE TABLE "inventory_slots" (
	"account_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"item_instance_id" uuid NOT NULL,
	"location" text DEFAULT 'stash' NOT NULL,
	CONSTRAINT "inventory_slots_account_id_slot_pk" PRIMARY KEY("account_id","slot"),
	CONSTRAINT "inventory_slots_slot_range" CHECK ("inventory_slots"."slot" >= 0),
	CONSTRAINT "inventory_slots_location_stash" CHECK ("inventory_slots"."location" = 'stash')
);
--> statement-breakpoint
CREATE TABLE "item_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"durability" integer,
	"origin" text NOT NULL,
	"location" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_instances_id_owner_location" UNIQUE("id","owner_account_id","location"),
	CONSTRAINT "item_instances_item_id_format" CHECK ("item_instances"."item_id" ~ '^item\.[a-z0-9_.]+$'),
	CONSTRAINT "item_instances_quantity_positive" CHECK ("item_instances"."quantity" > 0),
	CONSTRAINT "item_instances_durability_range" CHECK ("item_instances"."durability" IS NULL OR "item_instances"."durability" BETWEEN 0 AND 100),
	CONSTRAINT "item_instances_location_known" CHECK ("item_instances"."location" IN ('stash', 'inbox'))
);
--> statement-breakpoint
CREATE TABLE "ship_unlocks" (
	"account_id" uuid NOT NULL,
	"ship_id" text NOT NULL,
	"source" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ship_unlocks_account_id_ship_id_pk" PRIMARY KEY("account_id","ship_id"),
	CONSTRAINT "ship_unlocks_ship_id_format" CHECK ("ship_unlocks"."ship_id" ~ '^ship\.[a-z0-9_]+$')
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"credits" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_credits_not_negative" CHECK ("wallets"."credits" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inbox_entries" ADD CONSTRAINT "inbox_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_entries" ADD CONSTRAINT "inbox_entries_item_owned_in_inbox" FOREIGN KEY ("item_instance_id","account_id","location") REFERENCES "public"."item_instances"("id","owner_account_id","location") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_slots" ADD CONSTRAINT "inventory_slots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_slots" ADD CONSTRAINT "inventory_slots_item_owned_in_stash" FOREIGN KEY ("item_instance_id","account_id","location") REFERENCES "public"."item_instances"("id","owner_account_id","location") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_instances" ADD CONSTRAINT "item_instances_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ship_unlocks" ADD CONSTRAINT "ship_unlocks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_entries_item_key" ON "inbox_entries" USING btree ("item_instance_id");--> statement-breakpoint
CREATE INDEX "inbox_entries_account_idx" ON "inbox_entries" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_slots_item_key" ON "inventory_slots" USING btree ("item_instance_id");--> statement-breakpoint
CREATE INDEX "item_instances_owner_idx" ON "item_instances" USING btree ("owner_account_id");