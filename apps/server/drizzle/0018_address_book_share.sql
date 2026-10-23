ALTER TABLE "driver_company" ADD COLUMN "administrator" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "driver_company" SET "administrator" = true;
--> statement-breakpoint
ALTER TABLE "address_book_entry" ADD COLUMN "platform_shared" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "address_book_company_share" (
	"entry_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	CONSTRAINT "address_book_company_share_pkey" PRIMARY KEY("entry_id","company_id")
);
--> statement-breakpoint
ALTER TABLE "address_book_company_share" ADD CONSTRAINT "address_book_company_share_entry_id_address_book_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."address_book_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "address_book_company_share" ADD CONSTRAINT "address_book_company_share_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "address_book_company_share_company_id_idx" ON "address_book_company_share" USING btree ("company_id");
