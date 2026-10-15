CREATE TABLE "loadout_items" (
	"account_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"item_instance_id" uuid NOT NULL,
	"location" text DEFAULT 'stash' NOT NULL,
	CONSTRAINT "loadout_items_account_id_slot_pk" PRIMARY KEY("account_id","slot"),
	CONSTRAINT "loadout_items_slot_known" CHECK ("loadout_items"."slot" IN ('primary', 'sidearm', 'tool') OR "loadout_items"."slot" ~ '^backpack\.[0-7]$'),
	CONSTRAINT "loadout_items_location_stash" CHECK ("loadout_items"."location" = 'stash')
);
--> statement-breakpoint
ALTER TABLE "loadout_items" ADD CONSTRAINT "loadout_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_items" ADD CONSTRAINT "loadout_items_item_owned_in_stash" FOREIGN KEY ("item_instance_id","account_id","location") REFERENCES "public"."item_instances"("id","owner_account_id","location") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loadout_items_item_key" ON "loadout_items" USING btree ("item_instance_id");