ALTER TABLE "sortie_stop" ADD COLUMN "passenger" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "sortie_stop" SET "passenger" = true WHERE "role" <> 'pickup';--> statement-breakpoint
ALTER TABLE "sortie_stop" DROP COLUMN "role";
