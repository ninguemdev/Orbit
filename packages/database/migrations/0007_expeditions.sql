CREATE TABLE "active_participations" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"expedition_id" uuid NOT NULL,
	CONSTRAINT "active_participations_account_expedition" UNIQUE("account_id","expedition_id")
);
--> statement-breakpoint
CREATE TABLE "expedition_members" (
	"expedition_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"class_id" text NOT NULL,
	"loadout" jsonb NOT NULL,
	"final_state" text,
	CONSTRAINT "expedition_members_expedition_id_account_id_pk" PRIMARY KEY("expedition_id","account_id"),
	CONSTRAINT "expedition_members_class_id_format" CHECK ("expedition_members"."class_id" ~ '^class\.[a-z]+$')
);
--> statement-breakpoint
CREATE TABLE "expeditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text DEFAULT 'PREPARING' NOT NULL,
	"start_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"leader_account_id" uuid NOT NULL,
	"ship_id" text NOT NULL,
	"catalog_version" integer NOT NULL,
	"prepare_deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "expeditions_state_known" CHECK ("expeditions"."state" IN ('PREPARING', 'ACTIVE', 'EXTRACTING', 'SETTLING', 'CLOSED', 'CANCELLED', 'FAILED', 'ABORTED_TECHNICAL')),
	CONSTRAINT "expeditions_ended_when_terminal" CHECK (("expeditions"."state" IN ('CLOSED', 'CANCELLED', 'FAILED', 'ABORTED_TECHNICAL')) = ("expeditions"."ended_at" IS NOT NULL)),
	CONSTRAINT "expeditions_start_key_length" CHECK (length("expeditions"."start_key") BETWEEN 1 AND 200),
	CONSTRAINT "expeditions_request_hash_sha256_hex" CHECK ("expeditions"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "expeditions_ship_id_format" CHECK ("expeditions"."ship_id" ~ '^ship\.[a-z0-9_]+$')
);
--> statement-breakpoint
CREATE TABLE "item_reservations" (
	"item_instance_id" uuid PRIMARY KEY NOT NULL,
	"expedition_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"quantity" integer NOT NULL,
	"location" text DEFAULT 'stash' NOT NULL,
	CONSTRAINT "item_reservations_member_slot" UNIQUE("expedition_id","account_id","slot"),
	CONSTRAINT "item_reservations_slot_known" CHECK ("item_reservations"."slot" IN ('primary', 'sidearm', 'tool', 'backpack.0', 'backpack.1', 'backpack.2', 'backpack.3', 'backpack.4', 'backpack.5', 'backpack.6', 'backpack.7')),
	CONSTRAINT "item_reservations_quantity_positive" CHECK ("item_reservations"."quantity" > 0),
	CONSTRAINT "item_reservations_location_stash" CHECK ("item_reservations"."location" = 'stash')
);
--> statement-breakpoint
ALTER TABLE "item_instances" ADD CONSTRAINT "item_instances_id_owner_location_quantity" UNIQUE("id","owner_account_id","location","quantity");--> statement-breakpoint
ALTER TABLE "active_participations" ADD CONSTRAINT "active_participations_member" FOREIGN KEY ("expedition_id","account_id") REFERENCES "public"."expedition_members"("expedition_id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expedition_members" ADD CONSTRAINT "expedition_members_expedition_id_expeditions_id_fk" FOREIGN KEY ("expedition_id") REFERENCES "public"."expeditions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expedition_members" ADD CONSTRAINT "expedition_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expeditions" ADD CONSTRAINT "expeditions_leader_account_id_accounts_id_fk" FOREIGN KEY ("leader_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_reservations" ADD CONSTRAINT "item_reservations_item_owned_in_stash" FOREIGN KEY ("item_instance_id","account_id","location","quantity") REFERENCES "public"."item_instances"("id","owner_account_id","location","quantity") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_reservations" ADD CONSTRAINT "item_reservations_participation" FOREIGN KEY ("account_id","expedition_id") REFERENCES "public"."active_participations"("account_id","expedition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "active_participations_expedition_idx" ON "active_participations" USING btree ("expedition_id");--> statement-breakpoint
CREATE INDEX "expedition_members_account_idx" ON "expedition_members" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expeditions_start_key_key" ON "expeditions" USING btree ("start_key");--> statement-breakpoint
CREATE INDEX "item_reservations_participation_idx" ON "item_reservations" USING btree ("account_id","expedition_id");--> statement-breakpoint
CREATE TRIGGER "expeditions_touch_updated_at" BEFORE UPDATE ON "expeditions"
FOR EACH ROW EXECUTE FUNCTION "orbit_touch_updated_at"();
