import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  addressBookEntry,
  addressBookPhoneStar,
  company,
  driver,
  driverAvailabilityEvent,
  driverCompany,
  driverMeterReading,
  driverTariff,
  locationObservation,
  operationalEvent,
  session,
  sortie,
  sortieStop,
  user,
  userCredential,
} from "../schema.js";
import { readCalendar } from "./activity.js";
import type { ScheduleDeps, SortieInput } from "./support.js";

export async function companiesFor(userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: company.name })
    .from(company)
    .innerJoin(driverCompany, eq(driverCompany.companyId, company.id))
    .innerJoin(driver, eq(driver.id, driverCompany.driverId))
    .where(eq(driver.userId, userId));
  return rows.map((row) => row.name);
}

export async function shownDeparture(
  person: Parameters<typeof readCalendar>[0],
  sortieId: string,
  deps: ScheduleDeps,
): Promise<string | undefined> {
  const calendar = await readCalendar(
    person,
    new Date("2026-01-01T00:00:00.000Z"),
    new Date("2027-01-01T00:00:00.000Z"),
    deps,
  );
  if (!Array.isArray(calendar)) {
    return undefined;
  }
  return calendar.find((item) => item.id === sortieId)?.departureAddress;
}

export async function driverCount(userId: string): Promise<number> {
  const rows = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  return rows.length;
}

export async function eventsFor(
  sortieId: string,
): Promise<{ type: string; label: string; passengerPhone: string | null; stops: { label: string }[] }[]> {
  return db
    .select({
      type: operationalEvent.type,
      label: operationalEvent.label,
      passengerPhone: operationalEvent.passengerPhone,
      stops: operationalEvent.stops,
    })
    .from(operationalEvent)
    .where(eq(operationalEvent.sortieId, sortieId))
    .orderBy(operationalEvent.recordedAt);
}

export const originStop = {
  label: "Origin",
  latitude: 40.7128,
  longitude: -74.006,
  waitMinutes: 0,
  passenger: false,
};
export const destinationStop = {
  label: "Destination",
  latitude: 40.758,
  longitude: -73.9855,
  waitMinutes: 0,
  passenger: true,
};
export const waypointStop = {
  label: "Waypoint",
  latitude: 40.73,
  longitude: -73.99,
  waitMinutes: 0,
  passenger: true,
};

export const driverFix = { latitude: 40, longitude: -74 };
export const scheduleNow = new Date("2026-09-01T00:00:00.000Z");

export const hopMeters = 10 * 1609.344;
export const hopSeconds = 600;
export const lineT = new Date("2026-09-02T15:00:00.000Z");
export const pointA = { latitude: 40, longitude: -74 };
export const pointB = northOf(pointA, hopMeters);
export const pointC = northOf(pointB, hopMeters);
export const pointD = northOf(pointC, hopMeters);
export const pointE = northOf(pointD, hopMeters);
export const linePoints = [pointA, pointB, pointC, pointD, pointE];

export type DriveCall = {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  intermediates: { latitude: number; longitude: number }[];
};

export const scheduleDeps: ScheduleDeps = {
  now: () => scheduleNow,
  driveDuration: async (origin, destination) =>
    destination.latitude === originStop.latitude && origin.latitude !== originStop.latitude ? 0 : 3600,
  lookupAddress: async () => "Driver location",
};

export function northOf(
  from: { latitude: number; longitude: number },
  meters: number,
): { latitude: number; longitude: number } {
  return { latitude: from.latitude + meters / 111_320, longitude: from.longitude };
}

export function lineStop(
  point: { latitude: number; longitude: number },
  label: string,
  passenger: boolean,
): SortieInput["stops"][number] {
  return {
    label,
    latitude: point.latitude,
    longitude: point.longitude,
    waitMinutes: 0,
    passenger,
  };
}

export function lineIndex(coordinate: { latitude: number; longitude: number }): number | null {
  const index = linePoints.findIndex(
    (point) => point.latitude === coordinate.latitude && point.longitude === coordinate.longitude,
  );
  return index >= 0 ? index : null;
}

export function lineDriveDuration(calls: DriveCall[]): ScheduleDeps["driveDuration"] {
  return async (origin, destination, intermediates) => {
    calls.push({
      origin: { latitude: origin.latitude, longitude: origin.longitude },
      destination: { latitude: destination.latitude, longitude: destination.longitude },
      intermediates: intermediates.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
      })),
    });
    const from = lineIndex(origin);
    const to = lineIndex(destination);
    assert.notEqual(from, null);
    assert.notEqual(to, null);
    if (from === null || to === null) {
      return "failed";
    }
    return Math.abs(to - from) * hopSeconds;
  };
}

export function task(label: string, arrivalAt: Date | null, extra?: Partial<SortieInput>): SortieInput {
  return {
    label,
    arrivalAt,
    passengerName: null,
    passengerPhone: null,
    stops: [originStop, destinationStop],
    ...extra,
  };
}

export function taskJson(label: string, arrivalAt: string) {
  return {
    label,
    arrivalAt,
    passengerName: null,
    passengerPhone: null,
    stops: [originStop, destinationStop],
  };
}

export async function placeDriver(
  userId: string,
  coordinate: { latitude: number; longitude: number } = driverFix,
): Promise<void> {
  const rows = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  const row = rows[0];
  if (!row) {
    throw new Error("driver missing");
  }
  await db.insert(locationObservation).values({
    driverId: row.id,
    observedAt: new Date("2026-09-01T12:00:00.000Z"),
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    accuracyMeters: 8,
  });
}

export async function removeUser(userId: string): Promise<void> {
  const drivers = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  for (const row of drivers) {
    await db.delete(addressBookEntry).where(eq(addressBookEntry.driverId, row.id));
    await db.delete(addressBookPhoneStar).where(eq(addressBookPhoneStar.driverId, row.id));
    await db.delete(driverMeterReading).where(eq(driverMeterReading.driverId, row.id));
    await db.delete(locationObservation).where(eq(locationObservation.driverId, row.id));
    const sorties = await db.select({ id: sortie.id }).from(sortie).where(eq(sortie.authorDriverId, row.id));
    for (const item of sorties) {
      await db.delete(operationalEvent).where(eq(operationalEvent.sortieId, item.id));
      await db.delete(sortieStop).where(eq(sortieStop.sortieId, item.id));
    }
    await db.delete(sortie).where(eq(sortie.authorDriverId, row.id));
    await db.delete(driverTariff).where(eq(driverTariff.driverId, row.id));
    const links = await db
      .select({ companyId: driverCompany.companyId })
      .from(driverCompany)
      .where(eq(driverCompany.driverId, row.id));
    await db.delete(driverAvailabilityEvent).where(eq(driverAvailabilityEvent.driverId, row.id));
    await db.delete(driverCompany).where(eq(driverCompany.driverId, row.id));
    await db.delete(driver).where(eq(driver.id, row.id));
    for (const link of links) {
      await db.delete(company).where(eq(company.id, link.companyId));
    }
  }
  await db.delete(session).where(eq(session.userId, userId));
  await db.delete(userCredential).where(eq(userCredential.userId, userId));
  await db.delete(user).where(eq(user.id, userId));
}
