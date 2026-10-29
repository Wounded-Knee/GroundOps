ALTER TABLE "location_observation" ADD COLUMN "client_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "location_observation_driver_client_id_key" ON "location_observation" ("driver_id", "client_id") WHERE "client_id" IS NOT NULL;
