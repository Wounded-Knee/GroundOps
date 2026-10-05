ALTER TABLE "sortie" ADD COLUMN "actual_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sortie_stop" ADD COLUMN "wait_minutes" integer DEFAULT 0 NOT NULL;
