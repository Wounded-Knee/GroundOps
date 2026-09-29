import type { GeoCoordinate, SortieStop } from "@groundops/contracts";

/** Ten statute miles. A later fix at least this far from the last computation anchor recomputes the window. */
export const recomputeMeters = 10 * 1609.344;

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
  scheduledStart: Date;
  scheduledEnd: Date;
};

export type SortiePlace = {
  id: string;
  arrivalAt: Date;
  destination: GeoCoordinate;
  destinationLabel: string;
};

export type ApproachOrigin = GeoCoordinate & {
  label: string | null;
};

/** The drive to this origin starts at the previous sortie's destination when one is earlier on the schedule. */
export function approachOrigin(
  places: SortiePlace[],
  arrivalAt: Date,
  id: string | null,
  currentPosition: GeoCoordinate | null,
): ApproachOrigin | null {
  const previous = previousPlace(places, arrivalAt, id);
  if (previous) {
    return { ...previous.destination, label: previous.destinationLabel };
  }
  if (!currentPosition) {
    return null;
  }
  return { ...currentPosition, label: null };
}

function previousPlace(places: SortiePlace[], arrivalAt: Date, id: string | null): SortiePlace | null {
  let previous: SortiePlace | null = null;
  for (const place of places) {
    if (id !== null && place.id === id) {
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
  stops: SortieStop[],
  arrivalAt: Date,
  now: Date,
  driveDuration: DriveDuration,
): Promise<ComputedWindow | "failed"> {
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  if (!origin || !destination) {
    return "failed";
  }

  const approach = await approachSeconds(position, origin, arrivalAt, now, driveDuration);
  if (approach === "failed") {
    return "failed";
  }

  const intermediates = stops.slice(1, -1).map((stop) => ({
    latitude: stop.latitude,
    longitude: stop.longitude,
  }));
  const onward = await driveDuration(
    { latitude: origin.latitude, longitude: origin.longitude },
    { latitude: destination.latitude, longitude: destination.longitude },
    intermediates,
    futureDeparture(arrivalAt, now),
  );
  if (typeof onward !== "number") {
    return "failed";
  }

  return {
    scheduledStart: new Date(arrivalAt.getTime() - approach * 1000),
    scheduledEnd: new Date(arrivalAt.getTime() + onward * 1000),
  };
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

async function approachSeconds(
  position: GeoCoordinate,
  origin: SortieStop,
  arrivalAt: Date,
  now: Date,
  driveDuration: DriveDuration,
): Promise<number | "failed"> {
  const originCoordinate = { latitude: origin.latitude, longitude: origin.longitude };
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
