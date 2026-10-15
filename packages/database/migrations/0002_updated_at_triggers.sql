-- updated_at follows the database clock on every UPDATE, including writes made
-- outside the Drizzle query builder (raw SQL, maintenance scripts).
CREATE FUNCTION "orbit_touch_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "accounts_touch_updated_at" BEFORE UPDATE ON "accounts"
FOR EACH ROW EXECUTE FUNCTION "orbit_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "profiles_touch_updated_at" BEFORE UPDATE ON "profiles"
FOR EACH ROW EXECUTE FUNCTION "orbit_touch_updated_at"();
