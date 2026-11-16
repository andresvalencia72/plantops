CREATE TABLE "plants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plants_organization_id_id" UNIQUE("organization_id","id"),
	CONSTRAINT "plants_organization_name" UNIQUE("organization_id","name"),
	CONSTRAINT "plants_name_length" CHECK (
    length("plants"."name") BETWEEN 3 AND 160
  ),
	CONSTRAINT "plants_iana_zone_format" CHECK (
    "plants"."time_zone" ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$'
  )
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "plant_id" uuid;--> statement-breakpoint
ALTER TABLE "plants" ADD CONSTRAINT "plants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_plant_tenant_fk" FOREIGN KEY ("organization_id","plant_id") REFERENCES "public"."plants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Enforce the IANA registry at SQL level, including writes outside NestJS.
-- Named zones accepted by the server must exist in PostgreSQL's tzdata.
CREATE FUNCTION plants_validate_iana_time_zone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.time_zone IS DISTINCT FROM OLD.time_zone
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
  ) THEN
    RAISE EXCEPTION 'Plant tenant/time zone changes require an audited migration'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_timezone_names AS zone WHERE zone.name = NEW.time_zone
  ) THEN
    RAISE EXCEPTION 'Unknown IANA plant time zone'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER plants_validate_iana_zone_on_write
BEFORE INSERT OR UPDATE OF time_zone, organization_id ON plants
FOR EACH ROW EXECUTE FUNCTION plants_validate_iana_time_zone();
