CREATE TABLE "settlements" (
	"expedition_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_outcome_known" CHECK ("settlements"."outcome" IN ('extracted', 'destroyed', 'timeout')),
	CONSTRAINT "settlements_manifest_hash_sha256_hex" CHECK ("settlements"."manifest_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_expedition_id_expeditions_id_fk" FOREIGN KEY ("expedition_id") REFERENCES "public"."expeditions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expedition_members" ADD CONSTRAINT "expedition_members_final_state_known" CHECK ("expedition_members"."final_state" IS NULL OR "expedition_members"."final_state" IN ('extracted', 'not_eligible', 'destroyed', 'timeout'));