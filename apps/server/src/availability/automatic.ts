import type { GeoCoordinate, User } from "@groundops/contracts";
import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../db.js";
import { driver, locationObservation, sortie } from "../schema.js";
import { setAvailability } from "./availability.js";

const boundaryEpsilon = 1e-9;

/** A lead check, calendar guidance, a commencement, or the conclusion of a sortie. */
export type AvailabilityEvent = "lead" | "guidance" | "commencement" | "conclusion";

export type AutomaticAvailabilityInput = {
  event: AvailabilityEvent;
  /** An uncommenced sortie starts in strictly less than the threshold. */
  withinLead: boolean;
  /** The sortie being commenced has a passenger stop. */
  fareBearing?: boolean;
  autoSetUnavailable: boolean;
  autoSetAvailable: boolean;
};

/**
 * The choice to write for one event, or null when this event must not change it.
 * Lead, calendar guidance, commencing a fare, and a driving route toward a passenger stop of a sortie already in progress set unavailable only.
 * Commencing a sortie without a passenger, and concluding a sortie, set available, unless another sortie is already inside the lead.
 */
export function automaticAvailabilityChoice(input: AutomaticAvailabilityInput): boolean | null {
  if (input.event === "guidance") {
    return input.autoSetUnavailable ? false : null;
  }
  if (input.withinLead && input.autoSetUnavailable) {
    return false;
  }
  if (input.event === "commencement" && input.fareBearing) {
    return input.autoSetUnavailable ? false : null;
  }
  if ((input.event === "commencement" || input.event === "conclusion") && input.autoSetAvailable) {
    return true;
  }
  return null;
}

/**
 * Calendar Guide. Sets unavailable when that flag is on.
 * When the flag is off, this is the same check as commencement.
 */
export function guidanceAvailabilityChoice(
  input: Omit<AutomaticAvailabilityInput, "event">,
): boolean | null {
  if (input.autoSetUnavailable) {
    return false;
  }
  return automaticAvailabilityChoice({ ...input, event: "commencement" });
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
  autoAvailableDeferred: boolean;
};

/** Applies one availability event for this driver. A missing driver does nothing. */
export async function applyAutomaticAvailability(
  person: User,
  event: AvailabilityEvent,
  now: Date,
  fareBearing = false,
): Promise<void> {
  const rows = await db
    .select(driverAutomaticSelect)
    .from(driver)
    .where(eq(driver.userId, person.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return;
  }
  await applyEvent(row, event, now, fareBearing);
}

/** Calendar Guide. Sets unavailable when that flag is on; otherwise the commencement check. */
export async function applyGuidanceAvailability(person: User, now: Date): Promise<void> {
  const rows = await db
    .select(driverAutomaticSelect)
    .from(driver)
    .where(eq(driver.userId, person.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return;
  }
  const choice = guidanceAvailabilityChoice({
    withinLead: await withinLead(row.id, row.thresholdMinutes, now),
    autoSetUnavailable: row.autoSetUnavailable,
    autoSetAvailable: row.autoSetAvailable,
  });
  await writeChoice(row, choice, now);
}

/** Lead check for every driver who can be set unavailable. Does not set anyone available. */
export async function applyAutomaticAvailabilityLead(now: Date): Promise<void> {
  const rows = await db
    .select(driverAutomaticSelect)
    .from(driver)
    .where(eq(driver.autoSetUnavailable, true));
  for (const row of rows) {
    await applyEvent(row, "lead", now);
  }
}

const driverAutomaticSelect = {
  id: driver.id,
  userId: driver.userId,
  thresholdMinutes: driver.availabilityThresholdMinutes,
  autoSetUnavailable: driver.autoSetUnavailable,
  autoSetAvailable: driver.autoSetAvailable,
  geofence: driver.availabilityGeofence,
  autoAvailableDeferred: driver.availabilityAutoAvailableDeferred,
};

/**
 * Releases a postponed available when this driver's latest fix is inside the ring.
 * An outside fix, an empty ring, or a missing postponement leaves the choice unchanged.
 */
export async function applyDeferredAvailability(person: User, now: Date): Promise<void> {
  const row = await loadDriver(person.id);
  if (!row?.autoAvailableDeferred) {
    return;
  }
  if (!row.autoSetAvailable) {
    await rememberDeferred(row, false);
    return;
  }
  const ring = ringOf(row.geofence);
  if (ring.length < 3) {
    return;
  }
  const fix = await latestFix(row.id);
  if (!fix || !pointInGeofence(fix, ring)) {
    return;
  }
  await rememberDeferred(row, false);
  await setAvailability(automaticUser(row), true, now);
}

/**
 * After settings are stored. Turning automatic available off drops a postponement.
 * Clearing the ring removes the exclusion and applies a postponement, unless a lead would set unavailable.
 */
export async function settleAvailabilitySettings(person: User, now: Date): Promise<void> {
  const row = await loadDriver(person.id);
  if (!row?.autoAvailableDeferred) {
    return;
  }
  if (!row.autoSetAvailable) {
    await rememberDeferred(row, false);
    return;
  }
  if (ringOf(row.geofence).length >= 3) {
    return;
  }
  const lead = await withinLead(row.id, row.thresholdMinutes, now);
  await rememberDeferred(row, false);
  if (lead && row.autoSetUnavailable) {
    return;
  }
  await setAvailability(automaticUser(row), true, now);
}

async function loadDriver(userId: string): Promise<DriverAutomaticRow | null> {
  const rows = await db.select(driverAutomaticSelect).from(driver).where(eq(driver.userId, userId)).limit(1);
  return rows[0] ?? null;
}

async function applyEvent(
  row: DriverAutomaticRow,
  event: AvailabilityEvent,
  now: Date,
  fareBearing = false,
): Promise<void> {
  const lead = await withinLead(row.id, row.thresholdMinutes, now);
  const choice = automaticAvailabilityChoice({
    event,
    withinLead: lead,
    fareBearing,
    autoSetUnavailable: row.autoSetUnavailable,
    autoSetAvailable: row.autoSetAvailable,
  });
  await writeChoice(row, choice, now);
}

async function writeChoice(row: DriverAutomaticRow, choice: boolean | null, now: Date): Promise<void> {
  if (choice === null) {
    return;
  }
  if (choice === false) {
    await rememberDeferred(row, false);
    await setAvailability(automaticUser(row), false, now);
    return;
  }
  if (await fixOutsideGeofence(row)) {
    await rememberDeferred(row, true);
    return;
  }
  await rememberDeferred(row, false);
  await setAvailability(automaticUser(row), true, now);
}

function automaticUser(row: DriverAutomaticRow): User {
  return {
    id: row.userId,
    displayName: null,
    email: null,
    platformAdministrator: false,
  };
}

async function rememberDeferred(row: DriverAutomaticRow, deferred: boolean): Promise<void> {
  if (row.autoAvailableDeferred === deferred) {
    return;
  }
  await db
    .update(driver)
    .set({ availabilityAutoAvailableDeferred: deferred })
    .where(eq(driver.id, row.id));
  row.autoAvailableDeferred = deferred;
}

/** True only when a saved ring exists and the latest fix lies outside it. No ring, or no fix, is not outside. */
async function fixOutsideGeofence(row: DriverAutomaticRow): Promise<boolean> {
  const ring = ringOf(row.geofence);
  if (ring.length < 3) {
    return false;
  }
  const fix = await latestFix(row.id);
  if (!fix) {
    return false;
  }
  return !pointInGeofence(fix, ring);
}

function ringOf(value: unknown): GeoCoordinate[] {
  return Array.isArray(value) ? value : [];
}

async function latestFix(driverId: string): Promise<GeoCoordinate | null> {
  const rows = await db
    .select({
      latitude: locationObservation.latitude,
      longitude: locationObservation.longitude,
    })
    .from(locationObservation)
    .where(eq(locationObservation.driverId, driverId))
    .orderBy(desc(locationObservation.observedAt), desc(locationObservation.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { latitude: row.latitude, longitude: row.longitude };
}

/** True when an uncommenced sortie is scheduled to start in strictly less than the threshold. */
async function withinLead(driverId: string, thresholdMinutes: number, now: Date): Promise<boolean> {
  if (thresholdMinutes <= 0) {
    return false;
  }
  const upcoming = await db
    .select({ scheduledStart: sortie.scheduledStart })
    .from(sortie)
    .where(and(eq(sortie.authorDriverId, driverId), isNull(sortie.actualStart), gte(sortie.scheduledStart, now)))
    .orderBy(asc(sortie.scheduledStart))
    .limit(1);
  const next = upcoming[0];
  if (!next) {
    return false;
  }
  const remainingMs = next.scheduledStart.getTime() - now.getTime();
  return remainingMs < thresholdMinutes * 60_000;
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
  if (
    Math.abs(first.latitude - last.latitude) <= boundaryEpsilon &&
    Math.abs(first.longitude - last.longitude) <= boundaryEpsilon
  ) {
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
