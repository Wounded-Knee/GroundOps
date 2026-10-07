ALTER TABLE "sortie" ADD COLUMN "actual_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sortie_stop" ADD COLUMN "actual_arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sortie_stop" ADD COLUMN "actual_departed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "location_observation" ADD COLUMN "sortie_id" uuid;--> statement-breakpoint
ALTER TABLE "location_observation" ADD CONSTRAINT "location_observation_sortie_id_sortie_id_fk" FOREIGN KEY ("sortie_id") REFERENCES "public"."sortie"("id") ON DELETE no action ON UPDATE no action;
