import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** Platform user. The SQL name is quoted because user is reserved. */
export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** External credential link. This slice writes provider google only. */
export const userCredential = pgTable(
  "user_credential",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
  },
  (table) => [uniqueIndex("user_credential_provider_subject_key").on(table.provider, table.subject)],
);

/** Opaque session. The raw token is never stored. */
export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
});

export const schema = { user, userCredential, session };
