import type { GeoCoordinate } from "@groundops/contracts";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  pgTable,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { company } from "./platform.js";
import { driver } from "./driver.js";

type StoredStop = {
  label: string;
  latitude: number;
  longitude: number;
  waitMinutes: number;
  passenger: boolean;
  actualArrivedAt: string | null;
  actualDepartedAt: string | null;
};

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
  actualStart: timestamp("actual_start", { withTimezone: true, mode: "date" }),
  actualEnd: timestamp("actual_end", { withTimezone: true, mode: "date" }),
  scheduleOriginLatitude: doublePrecision("schedule_origin_latitude"),
  scheduleOriginLongitude: doublePrecision("schedule_origin_longitude"),
  scheduleFailedAt: timestamp("schedule_failed_at", { withTimezone: true, mode: "date" }),
  passengerName: text("passenger_name"),
  passengerPhone: text("passenger_phone"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Ordered places on a sortie. Client order is canonical. */
export const sortieStop = pgTable(
  "sortie_stop",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sortieId: uuid("sortie_id")
      .notNull()
      .references(() => sortie.id),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    waitMinutes: integer("wait_minutes").notNull().default(0),
    passenger: boolean("passenger").notNull().default(false),
    actualArrivedAt: timestamp("actual_arrived_at", { withTimezone: true, mode: "date" }),
    actualDepartedAt: timestamp("actual_departed_at", { withTimezone: true, mode: "date" }),
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
    sortieId: uuid("sortie_id").references(() => sortie.id),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracyMeters: doublePrecision("accuracy_meters"),
  },
  (table) => [index("location_observation_driver_id_observed_at_idx").on(table.driverId, table.observedAt)],
);

/** Latest meter snapshot for one driver. The navigating phone replaces this row. */
export const driverMeterReading = pgTable("driver_meter_reading", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id")
    .notNull()
    .unique()
    .references(() => driver.id),
  sortieId: uuid("sortie_id")
    .notNull()
    .references(() => sortie.id),
  milesTraveled: doublePrecision("miles_traveled").notNull(),
  waitSeconds: doublePrecision("wait_seconds").notNull(),
  totalCents: integer("total_cents").notNull(),
  estimateCents: integer("estimate_cents").notNull(),
  remainingMeters: doublePrecision("remaining_meters").notNull(),
  overviewPath: jsonb("overview_path").$type<GeoCoordinate[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

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
