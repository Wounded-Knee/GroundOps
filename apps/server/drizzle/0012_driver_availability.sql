ALTER TABLE "driver" ADD COLUMN "available" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "availability_checked_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "driver_availability_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"available" boolean NOT NULL,
	"current" boolean NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_availability_event" ADD CONSTRAINT "driver_availability_event_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE no action ON UPDATE no action;
