CREATE TABLE "address_book_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "address_book_entry" ADD CONSTRAINT "address_book_entry_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "address_book_entry_driver_id_idx" ON "address_book_entry" USING btree ("driver_id");
--> statement-breakpoint
CREATE TABLE "address_book_phone_star" (
	"driver_id" uuid NOT NULL,
	"contact_id" text NOT NULL,
	"address_id" text NOT NULL,
	CONSTRAINT "address_book_phone_star_pkey" PRIMARY KEY("driver_id","contact_id","address_id")
);
--> statement-breakpoint
ALTER TABLE "address_book_phone_star" ADD CONSTRAINT "address_book_phone_star_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE no action ON UPDATE no action;
