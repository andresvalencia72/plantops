ALTER TABLE "incidents" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "request_hash" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_actor_idempotency_key" UNIQUE("organization_id","reported_by_membership_id","idempotency_key");