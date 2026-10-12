ALTER TABLE "driver" ADD COLUMN "availability_threshold_minutes" integer DEFAULT 15 NOT NULL;
--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "auto_set_unavailable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "auto_set_available" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "availability_geofence" jsonb DEFAULT '[]'::jsonb NOT NULL;
