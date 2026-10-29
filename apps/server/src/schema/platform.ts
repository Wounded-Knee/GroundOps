import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Company of record for sorties this driver authors. */
export const company = pgTable("company", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** External place that imposes procedures. This slice stores the name only. */
export const facility = pgTable("facility", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
