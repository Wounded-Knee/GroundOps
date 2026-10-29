import type { GeoCoordinate } from "@groundops/contracts";
import { boolean, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { company } from "./platform.js";
import { user } from "./identity.js";

/** A user in an operational capacity. One user has one driver. */
export const driver = pgTable("driver", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  /** The driver's choice. A missed check-in does not clear it. */
  available: boolean("available").notNull().default(false),
  /** Last client check-in while available. Null when the driver is not available. */
  availabilityCheckedAt: timestamp("availability_checked_at", { withTimezone: true, mode: "date" }),
  /** Lead time before a scheduled start that forces unavailable when that flag is on. */
  availabilityThresholdMinutes: integer("availability_threshold_minutes").notNull().default(15),
  /** When on, the lead before a sortie, calendar guidance, commencing a fare, or starting a passenger leg sets the choice unavailable. */
  autoSetUnavailable: boolean("auto_set_unavailable").notNull().default(true),
  /** When on, commencing or concluding a sortie sets the choice available, unless the latest fix is outside the geofence. */
  autoSetAvailable: boolean("auto_set_available").notNull().default(true),
  /** Polygon ring. Empty means no availability geofence. */
  availabilityGeofence: jsonb("availability_geofence").$type<GeoCoordinate[]>().notNull().default([]),
  /** An automatic true is waiting for a GPS fix inside the availability geofence. */
  availabilityAutoAvailableDeferred: boolean("availability_auto_available_deferred").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Choice changes, a lapse, or a check-in that restores reachability. */
export const driverAvailabilityEvent = pgTable("driver_availability_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => driver.id),
  available: boolean("available").notNull(),
  current: boolean("current").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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
    /** A company administrator can share their own places with this company. */
    administrator: boolean("administrator").notNull().default(false),
  },
  (table) => [uniqueIndex("driver_company_driver_id_company_id_key").on(table.driverId, table.companyId)],
);
