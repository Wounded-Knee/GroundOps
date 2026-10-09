CREATE TABLE "driver_meter_reading" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"sortie_id" uuid NOT NULL,
	"miles_traveled" double precision NOT NULL,
	"wait_seconds" double precision NOT NULL,
	"total_cents" integer NOT NULL,
	"estimate_cents" integer NOT NULL,
	"remaining_meters" double precision NOT NULL,
	"overview_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_meter_reading_driver_id_unique" UNIQUE("driver_id")
);
--> statement-breakpoint
ALTER TABLE "driver_meter_reading" ADD CONSTRAINT "driver_meter_reading_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "driver_meter_reading" ADD CONSTRAINT "driver_meter_reading_sortie_id_sortie_id_fk" FOREIGN KEY ("sortie_id") REFERENCES "public"."sortie"("id") ON DELETE no action ON UPDATE no action;
