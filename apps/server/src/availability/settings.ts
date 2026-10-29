import type { AvailabilitySettings, GeoCoordinate, User } from "@groundops/contracts";
import { eq } from "drizzle-orm";
import { ensureDriver } from "../identity/driver.js";
import { db } from "../db.js";
import { driver } from "../schema.js";
import { settleAvailabilitySettings } from "./automatic.js";

/** Reads the driver's availability settings, creating the driver when needed. */
export async function readAvailabilitySettings(person: User): Promise<AvailabilitySettings> {
  const ensured = await ensureDriver(person);
  const rows = await db
    .select({
      thresholdMinutes: driver.availabilityThresholdMinutes,
      autoSetUnavailable: driver.autoSetUnavailable,
      autoSetAvailable: driver.autoSetAvailable,
      geofence: driver.availabilityGeofence,
    })
    .from(driver)
    .where(eq(driver.id, ensured.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("driver missing");
  }
  return {
    thresholdMinutes: row.thresholdMinutes,
    autoSetUnavailable: row.autoSetUnavailable,
    autoSetAvailable: row.autoSetAvailable,
    geofence: sanitizeRing(row.geofence),
  };
}

/** Replaces the driver's availability settings. */
export async function replaceAvailabilitySettings(
  person: User,
  settings: AvailabilitySettings,
  now: Date = new Date(),
): Promise<AvailabilitySettings> {
  const ensured = await ensureDriver(person);
  const geofence = settings.geofence.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
  }));
  await db
    .update(driver)
    .set({
      availabilityThresholdMinutes: settings.thresholdMinutes,
      autoSetUnavailable: settings.autoSetUnavailable,
      autoSetAvailable: settings.autoSetAvailable,
      availabilityGeofence: geofence,
    })
    .where(eq(driver.id, ensured.id));
  await settleAvailabilitySettings(person, now);
  return {
    thresholdMinutes: settings.thresholdMinutes,
    autoSetUnavailable: settings.autoSetUnavailable,
    autoSetAvailable: settings.autoSetAvailable,
    geofence,
  };
}

function sanitizeRing(value: unknown): GeoCoordinate[] {
  if (!Array.isArray(value) || (value.length > 0 && value.length < 3)) {
    return [];
  }
  const ring: GeoCoordinate[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const point = item as { latitude?: unknown; longitude?: unknown };
    if (typeof point.latitude !== "number" || typeof point.longitude !== "number") {
      return [];
    }
    ring.push({ latitude: point.latitude, longitude: point.longitude });
  }
  return ring;
}
