ALTER TABLE "profiles" ADD COLUMN "class_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_class_id_format" CHECK ("profiles"."class_id" ~ '^class\.[a-z]+$');