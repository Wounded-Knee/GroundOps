import { boolean, doublePrecision, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { company } from "./platform.js";
import { driver } from "./driver.js";

/** A place the driver saved. Favorites sort ahead of the rest. */
export const addressBookEntry = pgTable(
  "address_book_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => driver.id),
    nickname: text("nickname").notNull(),
    placeName: text("place_name").notNull().default(""),
    label: text("label").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    favorite: boolean("favorite").notNull().default(false),
    /** When true, every signed-in user can read this place. The row stays with the owner. */
    platformShared: boolean("platform_shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("address_book_entry_driver_id_idx").on(table.driverId)],
);

/** Access to one saved place for every member of a company. The entry stays on the owning driver. */
export const addressBookCompanyShare = pgTable(
  "address_book_company_share",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => addressBookEntry.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.companyId] }),
    index("address_book_company_share_company_id_idx").on(table.companyId),
  ],
);

/** A star on a phone contact's postal address. The row stores no contact fields. */
export const addressBookPhoneStar = pgTable(
  "address_book_phone_star",
  {
    driverId: uuid("driver_id")
      .notNull()
      .references(() => driver.id),
    contactId: text("contact_id").notNull(),
    addressId: text("address_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.driverId, table.contactId, table.addressId] })],
);
