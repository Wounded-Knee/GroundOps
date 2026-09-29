CREATE TABLE "location_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_meters" double precision
);
--> statement-breakpoint
ALTER TABLE "operational_event" ADD COLUMN "arrival_at" timestamp with time zone;--> statement-breakpoint
UPDATE "operational_event" SET "arrival_at" = "scheduled_start" WHERE "arrival_at" IS NULL;--> statement-breakpoint
ALTER TABLE "operational_event" ALTER COLUMN "arrival_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sortie" ADD COLUMN "arrival_at" timestamp with time zone;--> statement-breakpoint
UPDATE "sortie" SET "arrival_at" = "scheduled_start" WHERE "arrival_at" IS NULL;--> statement-breakpoint
ALTER TABLE "sortie" ALTER COLUMN "arrival_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sortie" ADD COLUMN "schedule_origin_latitude" double precision;--> statement-breakpoint
ALTER TABLE "sortie" ADD COLUMN "schedule_origin_longitude" double precision;--> statement-breakpoint
ALTER TABLE "sortie" ADD COLUMN "schedule_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "location_observation" ADD CONSTRAINT "location_observation_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_observation_driver_id_observed_at_idx" ON "location_observation" USING btree ("driver_id","observed_at");