import type { GeoCoordinate, User } from "@groundops/contracts";
import { and, asc, desc, eq, gte, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "../db.js";
import { driver, locationObservation, sortie } from "../schema.js";
import { setAvailability } from "./availability.js";

const boundaryEpsilon = 1e-9;

export type AutomaticAvailabilityInput = {
  sortieInProgress: boolean;
  /** Milliseconds until the next uncommenced start at or after now. Null when there is none. */
  nextStartInMs: number | null;
  thresholdMinutes: number;
  fix: GeoCoordinate | null;
  geofence: GeoCoordinate[];
};

/** True when a sortie or a fix outside the geofence should force unavailable. */
export function availabilityForcingUnavailable(input: AutomaticAvailabilityInput): boolean {
  if (input.sortieInProgress) {
    return true;
  }
  if (
    input.nextStartInMs !== null &&
    input.nextStartInMs >= 0 &&
    input.nextStartInMs < input.thresholdMinutes * 60_000
  ) {
    return true;
  }
  if (input.fix && input.geofence.length >= 3 && !pointInGeofence(input.fix, input.geofence)) {
    return true;
  }
  return false;
}

/** Even-odd test. A point on the boundary counts as inside. Fewer than three vertices is not a ring. */
export function pointInGeofence(point: GeoCoordinate, ring: GeoCoordinate[]): boolean {
  const vertices = openRing(ring);
  if (vertices.length < 3) {
    return false;
  }
  if (pointOnBoundary(point, vertices)) {
    return true;
  }
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const current = vertices[index];
    const prior = vertices[previous];
    if (!current || !prior) {
      continue;
    }
    const crosses = current.latitude > point.latitude !== prior.latitude > point.latitude;
    if (!crosses) {
      continue;
    }
    const longitudeAtLatitude =
      ((prior.longitude - current.longitude) * (point.latitude - current.latitude)) /
        (prior.latitude - current.latitude) +
      current.longitude;
    if (point.longitude < longitudeAtLatitude) {
      inside = !inside;
    }
  }
  return inside;
}

type DriverAutomaticRow = {
  id: string;
  userId: string;
  thresholdMinutes: number;
  autoSetUnavailable: boolean;
  autoSetAvailable: boolean;
  geofence: GeoCoordinate[];
};

/** Applies the automatic rule for one driver. A missing driver does nothing. */
export async function reconcileAutomaticAvailability(person: User, now: Date): Promise<void> {
  const rows = await db
    .select(driverAutomaticSelect)
    .from(driver)
    .where(eq(driver.userId, person.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return;
  }
  await applyAutomaticAvailability(row, now);
}

/** Applies the automatic rule for every driver who has either flag on. */
export async function reconcileAllAutomaticAvailability(now: Date): Promise<void> {
  const rows = await db
    .select(driverAutomaticSelect)
    .from(driver)
    .where(or(eq(driver.autoSetUnavailable, true), eq(driver.autoSetAvailable, true)));
  for (const row of rows) {
    await applyAutomaticAvailability(row, now);
  }
}

const driverAutomaticSelect = {
  id: driver.id,
  userId: driver.userId,
  thresholdMinutes: driver.availabilityThresholdMinutes,
  autoSetUnavailable: driver.autoSetUnavailable,
  autoSetAvailable: driver.autoSetAvailable,
  geofence: driver.availabilityGeofence,
};

async function applyAutomaticAvailability(row: DriverAutomaticRow, now: Date): Promise<void> {
  if (!row.autoSetUnavailable && !row.autoSetAvailable) {
    return;
  }
  const forcing = availabilityForcingUnavailable(await loadFacts(row, now));
  const person: User = {
    id: row.userId,
    displayName: null,
    email: null,
    platformAdministrator: false,
  };
  if (forcing) {
    if (row.autoSetUnavailable) {
      await setAvailability(person, false, now);
    }
    return;
  }
  if (row.autoSetAvailable) {
    await setAvailability(person, true, now);
  }
}

async function loadFacts(row: DriverAutomaticRow, now: Date): Promise<AutomaticAvailabilityInput> {
  const inProgress = await db
    .select({ id: sortie.id })
    .from(sortie)
    .where(and(eq(sortie.authorDriverId, row.id), isNotNull(sortie.actualStart), isNull(sortie.actualEnd)))
    .limit(1);
  const upcoming = await db
    .select({ scheduledStart: sortie.scheduledStart })
    .from(sortie)
    .where(and(eq(sortie.authorDriverId, row.id), isNull(sortie.actualStart), gte(sortie.scheduledStart, now)))
    .orderBy(asc(sortie.scheduledStart))
    .limit(1);
  const fixes = await db
    .select({
      latitude: locationObservation.latitude,
      longitude: locationObservation.longitude,
    })
    .from(locationObservation)
    .where(eq(locationObservation.driverId, row.id))
    .orderBy(desc(locationObservation.observedAt), desc(locationObservation.id))
    .limit(1);
  const next = upcoming[0];
  return {
    sortieInProgress: Boolean(inProgress[0]),
    nextStartInMs: next ? next.scheduledStart.getTime() - now.getTime() : null,
    thresholdMinutes: row.thresholdMinutes,
    fix: fixes[0] ?? null,
    geofence: Array.isArray(row.geofence) ? row.geofence : [],
  };
}

function openRing(ring: GeoCoordinate[]): GeoCoordinate[] {
  if (ring.length < 2) {
    return ring.slice();
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) {
    return ring.slice();
  }
  if (Math.abs(first.latitude - last.latitude) <= boundaryEpsilon && Math.abs(first.longitude - last.longitude) <= boundaryEpsilon) {
    return ring.slice(0, -1);
  }
  return ring.slice();
}

function pointOnBoundary(point: GeoCoordinate, ring: GeoCoordinate[]): boolean {
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    if (start && end && onSegment(point, start, end)) {
      return true;
    }
  }
  return false;
}

function onSegment(point: GeoCoordinate, start: GeoCoordinate, end: GeoCoordinate): boolean {
  const edgeLongitude = end.longitude - start.longitude;
  const edgeLatitude = end.latitude - start.latitude;
  const offsetLongitude = point.longitude - start.longitude;
  const offsetLatitude = point.latitude - start.latitude;
  const length = Math.hypot(edgeLongitude, edgeLatitude);
  if (length === 0) {
    return Math.hypot(offsetLongitude, offsetLatitude) <= boundaryEpsilon;
  }
  const cross = offsetLongitude * edgeLatitude - offsetLatitude * edgeLongitude;
  if (Math.abs(cross) / length > boundaryEpsilon) {
    return false;
  }
  const dot = offsetLongitude * edgeLongitude + offsetLatitude * edgeLatitude;
  return dot >= -boundaryEpsilon && dot <= length * length + boundaryEpsilon;
}
