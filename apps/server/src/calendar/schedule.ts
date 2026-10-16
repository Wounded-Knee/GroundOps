import type { GeoCoordinate, SortieStopWrite } from "@groundops/contracts";

/** Five statute miles. A later fix at least this far from the last computation anchor recomputes the window. */
export const recomputeMeters = 5 * 1609.344;

/** One statute mile. A fix this close to a completed sortie's last place is still at that terminal. */
export const terminalPresenceMeters = 1609.344;

/** Half a statute mile. A fix this close to the next stop is already at that pickup. */
export const pickupPresenceMeters = 0.5 * 1609.344;

export const scheduleBackoffMs = 5 * 60 * 1000;

const refineThresholdMs = 2 * 60 * 1000;
const departureSlackMs = 5_000;

export type DriveDuration = (
  origin: GeoCoordinate,
  destination: GeoCoordinate,
  intermediates: GeoCoordinate[],
  departureTime: Date,
) => Promise<number | "no-route" | "failed">;

export type ComputedWindow = {
  arrivalAt: Date;
  scheduledStart: Date;
  scheduledEnd: Date;
};

export type SortiePlace = {
  id: string;
  arrivalAt: Date;
  scheduledEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
  destination: GeoCoordinate;
  destinationLabel: string;
};

export type ApproachOrigin = GeoCoordinate & {
  label: string | null;
};

/**
 * A later drive still leaves from this sortie's last place.
 * Completion ends that. The scheduled end passing does not, while this is the
 * sortie the driver commenced most recently and has not completed. A sortie
 * that was never commenced stops once its scheduled end is past.
 */
export function placeStillOpen(place: SortiePlace, now: Date, places: readonly SortiePlace[]): boolean {
  if (place.actualEnd !== null) {
    return false;
  }
  if (place.scheduledEnd.getTime() > now.getTime()) {
    return true;
  }
  return place.actualStart !== null && !laterCommencement(place, places);
}

function laterCommencement(place: SortiePlace, places: readonly SortiePlace[]): boolean {
  if (place.actualStart === null) {
    return false;
  }
  const started = place.actualStart.getTime();
  return places.some(
    (other) => other.id !== place.id && other.actualStart !== null && other.actualStart.getTime() > started,
  );
}

/** The drive starts at an earlier sortie's destination only while that sortie is still open. */
export function approachOrigin(
  places: SortiePlace[],
  arrivalAt: Date,
  id: string | null,
  currentPosition: GeoCoordinate | null,
  now: Date,
): ApproachOrigin | null {
  const previous = previousPlace(places, arrivalAt, id, now);
  if (previous) {
    return { ...previous.destination, label: previous.destinationLabel };
  }
  if (!currentPosition) {
    return null;
  }
  return { ...currentPosition, label: null };
}

function previousPlace(places: SortiePlace[], arrivalAt: Date, id: string | null, now: Date): SortiePlace | null {
  let previous: SortiePlace | null = null;
  for (const place of places) {
    if (id !== null && place.id === id) {
      continue;
    }
    if (!placeStillOpen(place, now, places)) {
      continue;
    }
    if (!sortsBefore(place, arrivalAt, id)) {
      continue;
    }
    if (previous === null || sortsBefore(previous, place.arrivalAt, place.id)) {
      previous = place;
    }
  }
  return previous;
}

function sortsBefore(place: SortiePlace, arrivalAt: Date, id: string | null): boolean {
  const arrivalDelta = place.arrivalAt.getTime() - arrivalAt.getTime();
  if (arrivalDelta < 0) {
    return true;
  }
  if (arrivalDelta > 0) {
    return false;
  }
  if (id === null) {
    return true;
  }
  return place.id < id;
}

export async function computeWindow(
  position: GeoCoordinate,
  stops: SortieStopWrite[],
  arrivalAt: Date | null,
  now: Date,
  driveDuration: DriveDuration,
): Promise<ComputedWindow | "failed"> {
  const target = firstStop(stops);
  if (!target) {
    return "failed";
  }
  if (arrivalAt === null) {
    return immediateWindow(position, stops, target, now, driveDuration);
  }
  return authoredWindow(position, stops, target, arrivalAt, now, driveDuration);
}

export function distanceMeters(from: GeoCoordinate, to: GeoCoordinate): number {
  const earthRadius = 6_371_000;
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const dLat = lat2 - lat1;
  const dLng = toRadians(to.longitude - from.longitude);
  const chord = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(chord)));
}

export function movedFarEnough(from: GeoCoordinate, to: GeoCoordinate): boolean {
  return distanceMeters(from, to) >= recomputeMeters;
}

/** The stored anchor is a stray point, and the driver is at the latest completed sortie's last place. */
export function anchorAwayFromCompletedTerminal(
  places: readonly SortiePlace[],
  anchor: GeoCoordinate,
  gps: GeoCoordinate,
): boolean {
  let latest: SortiePlace | null = null;
  let latestEnded: Date | null = null;
  for (const place of places) {
    if (place.actualEnd === null) {
      continue;
    }
    if (latest === null || latestEnded === null || place.actualEnd.getTime() > latestEnded.getTime()) {
      latest = place;
      latestEnded = place.actualEnd;
    }
  }
  if (!latest) {
    return false;
  }
  return (
    distanceMeters(gps, latest.destination) <= terminalPresenceMeters &&
    distanceMeters(anchor, gps) > terminalPresenceMeters
  );
}

/** The driver is at the next stop and the cached origin is still somewhere else. */
export function anchorAwayFromPickup(
  anchor: GeoCoordinate,
  gps: GeoCoordinate,
  pickup: GeoCoordinate,
): boolean {
  return (
    distanceMeters(gps, pickup) <= pickupPresenceMeters &&
    distanceMeters(anchor, pickup) > pickupPresenceMeters
  );
}

async function authoredWindow(
  position: GeoCoordinate,
  stops: SortieStopWrite[],
  target: SortieStopWrite,
  arrivalAt: Date,
  now: Date,
  driveDuration: DriveDuration,
): Promise<ComputedWindow | "failed"> {
  const approach = await approachSeconds(position, coordinate(target), arrivalAt, now, driveDuration);
  if (approach === "failed") {
    return "failed";
  }
  const firstWaitSeconds = waitSeconds(target);
  const onwardDeparture = new Date(arrivalAt.getTime() + firstWaitSeconds * 1000);
  const onward = await onwardSeconds(stops, onwardDeparture, now, driveDuration);
  if (onward === "failed") {
    return "failed";
  }
  const dwellSeconds = firstWaitSeconds + laterWaitSeconds(stops, target);
  return {
    arrivalAt,
    scheduledStart: new Date(arrivalAt.getTime() - approach * 1000),
    scheduledEnd: new Date(arrivalAt.getTime() + (dwellSeconds + onward) * 1000),
  };
}

async function immediateWindow(
  position: GeoCoordinate,
  stops: SortieStopWrite[],
  target: SortieStopWrite,
  now: Date,
  driveDuration: DriveDuration,
): Promise<ComputedWindow | "failed"> {
  const approach = await driveDuration(position, coordinate(target), [], futureDeparture(now, now));
  if (typeof approach !== "number") {
    return "failed";
  }
  const arrivalAt = new Date(now.getTime() + approach * 1000);
  const firstWaitSeconds = waitSeconds(target);
  const onwardDeparture = new Date(arrivalAt.getTime() + firstWaitSeconds * 1000);
  const onward = await onwardSeconds(stops, onwardDeparture, now, driveDuration);
  if (onward === "failed") {
    return "failed";
  }
  const dwellSeconds = firstWaitSeconds + laterWaitSeconds(stops, target);
  return {
    arrivalAt,
    scheduledStart: new Date(now.getTime()),
    scheduledEnd: new Date(arrivalAt.getTime() + (dwellSeconds + onward) * 1000),
  };
}

function firstStop(stops: SortieStopWrite[]): SortieStopWrite | null {
  return stops[0] ?? null;
}

async function onwardSeconds(
  stops: SortieStopWrite[],
  departureAt: Date,
  now: Date,
  driveDuration: DriveDuration,
): Promise<number | "failed"> {
  if (stops.length < 2) {
    return 0;
  }
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  if (!origin || !destination) {
    return 0;
  }
  const intermediates = stops.slice(1, -1).map(coordinate);
  const onward = await driveDuration(
    coordinate(origin),
    coordinate(destination),
    intermediates,
    futureDeparture(departureAt, now),
  );
  return typeof onward === "number" ? onward : "failed";
}

function coordinate(stop: SortieStopWrite): GeoCoordinate {
  return { latitude: stop.latitude, longitude: stop.longitude };
}

function waitSeconds(stop: SortieStopWrite): number {
  return Math.max(0, stop.waitMinutes) * 60;
}

/** Waits on every stop after the first place on the sortie. */
function laterWaitSeconds(stops: SortieStopWrite[], first: SortieStopWrite): number {
  let seen = false;
  let total = 0;
  for (const stop of stops) {
    if (!seen) {
      if (stop === first || sameStop(stop, first)) {
        seen = true;
      }
      continue;
    }
    total += waitSeconds(stop);
  }
  return total;
}

function sameStop(left: SortieStopWrite, right: SortieStopWrite): boolean {
  return (
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.label === right.label
  );
}

async function approachSeconds(
  position: GeoCoordinate,
  origin: GeoCoordinate,
  arrivalAt: Date,
  now: Date,
  driveDuration: DriveDuration,
): Promise<number | "failed"> {
  const originCoordinate = origin;
  const firstDeparture = futureDeparture(arrivalAt, now);
  const first = await driveDuration(position, originCoordinate, [], firstDeparture);
  if (typeof first !== "number") {
    return "failed";
  }

  const refined = new Date(arrivalAt.getTime() - first * 1000);
  const secondDeparture = futureDeparture(refined, now);
  if (Math.abs(secondDeparture.getTime() - firstDeparture.getTime()) < refineThresholdMs) {
    return first;
  }

  const second = await driveDuration(position, originCoordinate, [], secondDeparture);
  if (typeof second !== "number") {
    return "failed";
  }
  return second;
}

function futureDeparture(instant: Date, now: Date): Date {
  return new Date(Math.max(instant.getTime(), now.getTime() + departureSlackMs));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
