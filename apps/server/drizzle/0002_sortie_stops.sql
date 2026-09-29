CREATE TABLE "sortie_stop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sortie_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operational_event" ADD COLUMN "passenger_name" text;--> statement-breakpoint
ALTER TABLE "operational_event" ADD COLUMN "passenger_phone" text;--> statement-breakpoint
ALTER TABLE "operational_event" ADD COLUMN "stops" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sortie" ADD COLUMN "passenger_name" text;--> statement-breakpoint
ALTER TABLE "sortie" ADD COLUMN "passenger_phone" text;--> statement-breakpoint
ALTER TABLE "sortie_stop" ADD CONSTRAINT "sortie_stop_sortie_id_sortie_id_fk" FOREIGN KEY ("sortie_id") REFERENCES "public"."sortie"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sortie_stop_sortie_id_position_key" ON "sortie_stop" USING btree ("sortie_id","position");