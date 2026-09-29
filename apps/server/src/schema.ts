import type { StopRole } from "@groundops/contracts";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

type StoredStop = {
  role: StopRole;
  label: string;
  latitude: number;
  longitude: number;
};

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

/** A user in an operational capacity. One user has one driver. */
export const driver = pgTable("driver", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Company of record for sorties this driver authors. */
export const company = pgTable("company", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Operational link between a driver and a company. The driver row stores no company id. */
export const driverCompany = pgTable(
  "driver_company",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => driver.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
  },
  (table) => [uniqueIndex("driver_company_driver_id_company_id_key").on(table.driverId, table.companyId)],
);

/** Authored sortie. Rows in this slice use type task. There is no responsible driver. */
export const sortie = pgTable("sortie", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => company.id),
  authorDriverId: uuid("author_driver_id")
    .notNull()
    .references(() => driver.id),
  type: text("type").notNull(),
  label: text("label").notNull(),
  arrivalAt: timestamp("arrival_at", { withTimezone: true, mode: "date" }).notNull(),
  arrivalAuthored: boolean("arrival_authored").notNull().default(true),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true, mode: "date" }).notNull(),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true, mode: "date" }).notNull(),
  scheduleOriginLatitude: doublePrecision("schedule_origin_latitude"),
  scheduleOriginLongitude: doublePrecision("schedule_origin_longitude"),
  scheduleOriginLabel: text("schedule_origin_label"),
  scheduleFailedAt: timestamp("schedule_failed_at", { withTimezone: true, mode: "date" }),
  passengerName: text("passenger_name"),
  passengerPhone: text("passenger_phone"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Ordered places on a sortie. A pickup, when present, is first. A destination, when present, is last. */
export const sortieStop = pgTable(
  "sortie_stop",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sortieId: uuid("sortie_id")
      .notNull()
      .references(() => sortie.id),
    position: integer("position").notNull(),
    role: text("role").notNull(),
    label: text("label").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
  },
  (table) => [uniqueIndex("sortie_stop_sortie_id_position_key").on(table.sortieId, table.position)],
);

/** Append-only history of sortie writes. Current state stays on the sortie row. */
export const operationalEvent = pgTable("operational_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  sortieId: uuid("sortie_id")
    .notNull()
    .references(() => sortie.id),
  label: text("label").notNull(),
  arrivalAt: timestamp("arrival_at", { withTimezone: true, mode: "date" }).notNull(),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true, mode: "date" }).notNull(),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true, mode: "date" }).notNull(),
  passengerName: text("passenger_name"),
  passengerPhone: text("passenger_phone"),
  stops: jsonb("stops").$type<StoredStop[]>().notNull().default([]),
});

/** Timestamped GPS fix from a driver's device. A track is not stored. */
export const locationObservation = pgTable(
  "location_observation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => driver.id),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracyMeters: doublePrecision("accuracy_meters"),
  },
  (table) => [index("location_observation_driver_id_observed_at_idx").on(table.driverId, table.observedAt)],
);

/** Programmable meter rates for one driver. Money is integer US cents. */
export const driverTariff = pgTable("driver_tariff", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id")
    .notNull()
    .unique()
    .references(() => driver.id),
  flagCents: integer("flag_cents").notNull(),
  perMileCents: integer("per_mile_cents").notNull(),
  perWaitMinuteCents: integer("per_wait_minute_cents").notNull(),
});

export const schema = {
  user,
  userCredential,
  session,
  driver,
  company,
  driverCompany,
  sortie,
  sortieStop,
  operationalEvent,
  locationObservation,
  driverTariff,
};
