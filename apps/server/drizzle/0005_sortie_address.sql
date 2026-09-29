ALTER TABLE "sortie" ADD COLUMN "arrival_authored" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sortie_stop" ADD COLUMN "role" text;--> statement-breakpoint
UPDATE "sortie_stop" AS stop
SET "role" = CASE
  WHEN stop.position = 0 THEN 'pickup'
  WHEN stop.position = (
    SELECT MAX(latest.position) FROM "sortie_stop" AS latest WHERE latest.sortie_id = stop.sortie_id
  ) THEN 'destination'
  ELSE 'waypoint'
END;--> statement-breakpoint
ALTER TABLE "sortie_stop" ALTER COLUMN "role" SET NOT NULL;