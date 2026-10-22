ALTER TABLE "address_book_entry" RENAME COLUMN "name" TO "nickname";
--> statement-breakpoint
ALTER TABLE "address_book_entry" ADD COLUMN "place_name" text DEFAULT '' NOT NULL;
