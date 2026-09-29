CREATE TABLE "driver_tariff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"flag_cents" integer NOT NULL,
	"per_mile_cents" integer NOT NULL,
	"per_wait_minute_cents" integer NOT NULL,
	CONSTRAINT "driver_tariff_driver_id_unique" UNIQUE("driver_id")
);
--> statement-breakpoint
ALTER TABLE "driver_tariff" ADD CONSTRAINT "driver_tariff_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE no action ON UPDATE no action;
