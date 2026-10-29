import {
  taskSortieType,
  type GeoCoordinate,
  type LocationFix,
  type Sortie,
  type SortieStop,
} from "@groundops/contracts";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db.js";
import { publishRealtime, sortieUpdated } from "../realtime.js";
import { locationObservation, operationalEvent, sortie, sortieStop } from "../schema.js";
import {
  approachOrigin,
  placeStillOpen,
  type ApproachOrigin,
  type DriveDuration,
  type SortiePlace,
} from "./schedule.js";

const sortieCreated = "sortie.created";
const sortieRevised = "sortie.revised";
const sortieScheduleComputed = "sortie.schedule_computed";
const sortieCommenced = "sortie.commenced";
const sortieCompleted = "sortie.completed";
const sortieStopArrivalInferred = "sortie.stop_arrival_inferred";
const sortieStopArrivalAsserted = "sortie.stop_arrival_asserted";
const sortieStopDepartureInferred = "sortie.stop_departure_inferred";
/** Matches mobile guidance arrivalMeters. */
const stopArrivalMeters = 40;
/** Sorts after any saved sortie id when two arrivals are equal. */
const previewPlaceId = "ffffffff-ffff-ffff-ffff-ffffffffffff";

export {
  previewPlaceId,
  sortieCommenced,
  sortieCompleted,
  sortieCreated,
  sortieRevised,
  sortieScheduleComputed,
  sortieStopArrivalAsserted,
  sortieStopArrivalInferred,
  sortieStopDepartureInferred,
  stopArrivalMeters,
};

export type SortieInput = {
  id?: string;
  label: string;
  arrivalAt: Date | null;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: Array<Pick<SortieStop, "label" | "latitude" | "longitude" | "waitMinutes" | "passenger">>;
};

export type ObservationInput = {
  id?: string | null;
  observedAt: Date;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  sortieId?: string | null;
};

export type ScheduleDeps = {
  driveDuration: DriveDuration;
  lookupAddress?: (position: GeoCoordinate) => Promise<string | null>;
  now: () => Date;
};

export const defaultScheduleDeps: ScheduleDeps = {
  driveDuration: async () => "failed",
  now: () => new Date(),
};

type ValidSortie = {
  label: string;
  arrivalAt: Date | null;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: SortieStop[];
};

type StopWrite = SortieInput["stops"][number];

export type Database = Pick<typeof db, "insert" | "select" | "update" | "delete">;

export type SortieRow = {
  id: string;
  label: string;
  arrivalAt: Date;
  scheduledStart: Date;
  scheduledEnd: Date;
  passengerName: string | null;
  passengerPhone: string | null;
};

export type StoredSortie = SortieRow & {
  arrivalAuthored: boolean;
  actualStart: Date | null;
  actualEnd: Date | null;
};

export const sortieSelect = {
  id: sortie.id,
  label: sortie.label,
  arrivalAt: sortie.arrivalAt,
  arrivalAuthored: sortie.arrivalAuthored,
  scheduledStart: sortie.scheduledStart,
  scheduledEnd: sortie.scheduledEnd,
  actualStart: sortie.actualStart,
  actualEnd: sortie.actualEnd,
  passengerName: sortie.passengerName,
  passengerPhone: sortie.passengerPhone,
};

export type OpenSortie = StoredSortie & {
  scheduleOriginLatitude: number | null;
  scheduleOriginLongitude: number | null;
  scheduleFailedAt: Date | null;
};

export type HeldWindow = {
  id: string;
  label: string;
  start: Date;
  end: Date;
  cachedStart: Date;
  cachedEnd: Date;
  changed: boolean;
  failed: boolean;
};

export function validSortie(input: SortieInput): ValidSortie | null {
  if (input.arrivalAt !== null && Number.isNaN(input.arrivalAt.getTime())) {
    return null;
  }
  const label = input.label.trim();

  const passengerName = blankToNull(input.passengerName);
  const passengerPhone = blankToNull(input.passengerPhone);
  if (passengerPhone !== null && !/^\d{10}$/.test(passengerPhone)) {
    return null;
  }

  const stops = orderedStops(input.stops);
  if (!stops) {
    return null;
  }
  return {
    label,
    arrivalAt: input.arrivalAt,
    passengerName,
    passengerPhone,
    stops,
  };
}

function orderedStops(input: StopWrite[]): SortieStop[] | null {
  if (input.length === 0) {
    return null;
  }
  const stops: SortieStop[] = [];
  for (const stop of input) {
    const stopLabel = stop.label.trim();
    if (stopLabel.length === 0 || !Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) {
      return null;
    }
    if (!Number.isInteger(stop.waitMinutes) || stop.waitMinutes < 0) {
      return null;
    }
    if (typeof stop.passenger !== "boolean") {
      return null;
    }
    stops.push({
      label: stopLabel,
      latitude: stop.latitude,
      longitude: stop.longitude,
      waitMinutes: stop.waitMinutes,
      passenger: stop.passenger,
      actualArrivedAt: null,
      actualDepartedAt: null,
    });
  }
  return stops;
}

export function validObservation(input: ObservationInput): boolean {
  if (Number.isNaN(input.observedAt.getTime())) {
    return false;
  }
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    return false;
  }
  if (input.accuracyMeters === null) {
    return true;
  }
  return Number.isFinite(input.accuracyMeters) && input.accuracyMeters >= 0;
}

function blankToNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function pickupCoordinates(sortieIds: string[]): Promise<Map<string, GeoCoordinate>> {
  const grouped = new Map<string, GeoCoordinate>();
  if (sortieIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .select({
      sortieId: sortieStop.sortieId,
      latitude: sortieStop.latitude,
      longitude: sortieStop.longitude,
    })
    .from(sortieStop)
    .where(and(inArray(sortieStop.sortieId, sortieIds), eq(sortieStop.position, 0)));
  for (const row of rows) {
    grouped.set(row.sortieId, { latitude: row.latitude, longitude: row.longitude });
  }
  return grouped;
}

export function anchorOf(row: OpenSortie): GeoCoordinate | null {
  if (row.scheduleOriginLatitude === null || row.scheduleOriginLongitude === null) {
    return null;
  }
  return { latitude: row.scheduleOriginLatitude, longitude: row.scheduleOriginLongitude };
}

export async function writeStops(tx: Database, sortieId: string, stops: SortieStop[]): Promise<void> {
  await tx.insert(sortieStop).values(
    stops.map((stop, position) => ({
      sortieId,
      position,
      label: stop.label,
      latitude: stop.latitude,
      longitude: stop.longitude,
      waitMinutes: stop.waitMinutes,
      passenger: stop.passenger,
      actualArrivedAt: stop.actualArrivedAt ? new Date(stop.actualArrivedAt) : null,
      actualDepartedAt: stop.actualDepartedAt ? new Date(stop.actualDepartedAt) : null,
    })),
  );
}

export function mergeStopActuals(next: SortieStop[], previous: SortieStop[], inProgress: boolean): SortieStop[] {
  if (!inProgress) {
    return next.map((stop) => ({
      ...stop,
      actualArrivedAt: null,
      actualDepartedAt: null,
    }));
  }
  return next.map((stop, index) => {
    const prior = previous[index];
    if (
      prior &&
      prior.latitude === stop.latitude &&
      prior.longitude === stop.longitude &&
      prior.label === stop.label
    ) {
      return {
        ...stop,
        actualArrivedAt: prior.actualArrivedAt,
        actualDepartedAt: prior.actualDepartedAt,
      };
    }
    return {
      ...stop,
      actualArrivedAt: null,
      actualDepartedAt: null,
    };
  });
}

export async function resolveInProgressSortie(
  driverId: string,
  preferredSortieId: string | null,
): Promise<StoredSortie | null> {
  if (preferredSortieId) {
    const preferred = await db
      .select(sortieSelect)
      .from(sortie)
      .where(
        and(
          eq(sortie.id, preferredSortieId),
          eq(sortie.authorDriverId, driverId),
          isNotNull(sortie.actualStart),
          isNull(sortie.actualEnd),
        ),
      )
      .limit(1);
    if (preferred[0]) {
      return preferred[0];
    }
  }
  const rows = await db
    .select(sortieSelect)
    .from(sortie)
    .where(and(eq(sortie.authorDriverId, driverId), isNotNull(sortie.actualStart), isNull(sortie.actualEnd)))
    .orderBy(asc(sortie.actualStart), asc(sortie.id));
  if (rows.length !== 1) {
    return null;
  }
  return rows[0] ?? null;
}

export async function writeEvent(tx: Database, type: string, row: SortieRow, stops: SortieStop[]): Promise<void> {
  await tx.insert(operationalEvent).values({
    type,
    sortieId: row.id,
    label: row.label,
    arrivalAt: row.arrivalAt,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    passengerName: row.passengerName,
    passengerPhone: row.passengerPhone,
    stops,
  });
}

export async function stopsBySortie(tx: Database, sortieIds: string[]): Promise<Map<string, SortieStop[]>> {
  const grouped = new Map<string, SortieStop[]>();
  if (sortieIds.length === 0) {
    return grouped;
  }
  const rows = await tx
    .select({
      sortieId: sortieStop.sortieId,
      position: sortieStop.position,
      label: sortieStop.label,
      latitude: sortieStop.latitude,
      longitude: sortieStop.longitude,
      waitMinutes: sortieStop.waitMinutes,
      passenger: sortieStop.passenger,
      actualArrivedAt: sortieStop.actualArrivedAt,
      actualDepartedAt: sortieStop.actualDepartedAt,
    })
    .from(sortieStop)
    .where(inArray(sortieStop.sortieId, sortieIds))
    .orderBy(asc(sortieStop.position));
  for (const row of rows) {
    const list = grouped.get(row.sortieId) ?? [];
    list.push({
      label: row.label,
      latitude: row.latitude,
      longitude: row.longitude,
      waitMinutes: row.waitMinutes,
      passenger: row.passenger,
      actualArrivedAt: row.actualArrivedAt ? row.actualArrivedAt.toISOString() : null,
      actualDepartedAt: row.actualDepartedAt ? row.actualDepartedAt.toISOString() : null,
    });
    grouped.set(row.sortieId, list);
  }
  return grouped;
}

export async function departurePosition(
  driverId: string,
  sortieId: string | null,
  arrivalAt: Date | null,
  now: Date,
): Promise<ApproachOrigin | null> {
  const gps = await latestObservation(db, driverId);
  if (arrivalAt === null) {
    if (!gps) {
      return null;
    }
    return { ...gps, label: null };
  }
  const places = await driverPlaces(driverId);
  return approachOrigin(places, arrivalAt, sortieId, gps, now);
}

async function originAddress(origin: ApproachOrigin, deps: ScheduleDeps): Promise<string> {
  const known = origin.label?.trim() ?? "";
  if (known.length > 0) {
    return known;
  }
  if (deps.lookupAddress) {
    const looked = (await deps.lookupAddress(origin))?.trim() ?? "";
    if (looked.length > 0) {
      return looked;
    }
  }
  return `${origin.latitude}, ${origin.longitude}`;
}

export async function openSorties(driverId: string, now: Date): Promise<OpenSortie[]> {
  return db
    .select({
      id: sortie.id,
      label: sortie.label,
      arrivalAt: sortie.arrivalAt,
      arrivalAuthored: sortie.arrivalAuthored,
      scheduledStart: sortie.scheduledStart,
      scheduledEnd: sortie.scheduledEnd,
      actualStart: sortie.actualStart,
      actualEnd: sortie.actualEnd,
      passengerName: sortie.passengerName,
      passengerPhone: sortie.passengerPhone,
      scheduleOriginLatitude: sortie.scheduleOriginLatitude,
      scheduleOriginLongitude: sortie.scheduleOriginLongitude,
      scheduleFailedAt: sortie.scheduleFailedAt,
    })
    .from(sortie)
    .where(and(eq(sortie.authorDriverId, driverId), gt(sortie.scheduledEnd, now)));
}

export async function driverPlaces(driverId: string): Promise<SortiePlace[]> {
  const rows = await db
    .select({
      id: sortie.id,
      arrivalAt: sortie.arrivalAt,
      scheduledEnd: sortie.scheduledEnd,
      actualStart: sortie.actualStart,
      actualEnd: sortie.actualEnd,
      label: sortieStop.label,
      latitude: sortieStop.latitude,
      longitude: sortieStop.longitude,
      position: sortieStop.position,
    })
    .from(sortie)
    .innerJoin(sortieStop, eq(sortieStop.sortieId, sortie.id))
    .where(eq(sortie.authorDriverId, driverId))
    .orderBy(asc(sortie.id), asc(sortieStop.position));

  const places: SortiePlace[] = [];
  for (const row of rows) {
    const destination = { latitude: row.latitude, longitude: row.longitude };
    const current = places[places.length - 1];
    if (current && current.id === row.id) {
      current.destination = destination;
      current.destinationLabel = row.label;
      continue;
    }
    places.push({
      id: row.id,
      arrivalAt: row.arrivalAt,
      scheduledEnd: row.scheduledEnd,
      actualStart: row.actualStart,
      actualEnd: row.actualEnd,
      destination,
      destinationLabel: row.label,
    });
  }
  return places;
}

export function samePlace(left: GeoCoordinate, right: GeoCoordinate): boolean {
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

export function anchorMatchesEndedPlace(places: SortiePlace[], anchor: GeoCoordinate, now: Date): boolean {
  return places.some((place) => !placeStillOpen(place, now, places) && samePlace(place.destination, anchor));
}

export function warningLabel(label: string, stops: SortieStop[]): string {
  const trimmed = label.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return stops[0]?.label ?? "";
}

export function windowsOverlap(start: Date, end: Date, otherStart: Date, otherEnd: Date): boolean {
  return start.getTime() < otherEnd.getTime() && otherStart.getTime() < end.getTime();
}

export async function latestObservation(tx: Database, driverId: string): Promise<GeoCoordinate | null> {
  const rows = await tx
    .select({
      latitude: locationObservation.latitude,
      longitude: locationObservation.longitude,
    })
    .from(locationObservation)
    .where(eq(locationObservation.driverId, driverId))
    .orderBy(desc(locationObservation.observedAt))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { latitude: row.latitude, longitude: row.longitude };
}
export async function latestFix(driverId: string): Promise<LocationFix | null> {
  const rows = await db
    .select({
      latitude: locationObservation.latitude,
      longitude: locationObservation.longitude,
      accuracyMeters: locationObservation.accuracyMeters,
      observedAt: locationObservation.observedAt,
    })
    .from(locationObservation)
    .where(eq(locationObservation.driverId, driverId))
    .orderBy(desc(locationObservation.observedAt))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracyMeters,
    observedAt: row.observedAt.toISOString(),
  };
}

export async function publishSortie(userId: string, sortie: Sortie): Promise<void> {
  await publishRealtime(sortieUpdated(userId, sortie));
}

export function toSortie(row: StoredSortie, stops: SortieStop[]): Sortie {
  return {
    id: row.id,
    type: taskSortieType,
    label: row.label,
    arrivalAt: row.arrivalAt.toISOString(),
    arrivalAuthored: row.arrivalAuthored,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    actualStart: row.actualStart ? row.actualStart.toISOString() : null,
    actualEnd: row.actualEnd ? row.actualEnd.toISOString() : null,
    departureAddress: "",
    passengerName: row.passengerName,
    passengerPhone: row.passengerPhone,
    stops,
  };
}

/** Fills depart-from from the previous still-open last stop, or the latest GPS fix when this sortie is next. */
export async function presentSorties(driverId: string, sorties: Sortie[], deps: ScheduleDeps): Promise<Sortie[]> {
  if (sorties.length === 0) {
    return [];
  }
  const now = deps.now();
  const places = await driverPlaces(driverId);
  const gps = await latestObservation(db, driverId);
  const gpsAddress: { value: Promise<string> | null } = { value: null };
  const presented: Sortie[] = [];
  for (const item of sorties) {
    const origin = approachOrigin(places, new Date(item.arrivalAt), item.id, gps, now);
    presented.push({ ...item, departureAddress: await departureAddressOf(origin, deps, gpsAddress) });
  }
  return presented;
}

export async function presentSortie(driverId: string, item: Sortie, deps: ScheduleDeps): Promise<Sortie> {
  const [presented] = await presentSorties(driverId, [item], deps);
  return presented ?? item;
}

async function departureAddressOf(
  origin: ApproachOrigin | null,
  deps: ScheduleDeps,
  gpsAddress: { value: Promise<string> | null },
): Promise<string> {
  if (!origin) {
    return "";
  }
  if (origin.label === null) {
    if (gpsAddress.value === null) {
      gpsAddress.value = originAddress(origin, deps);
    }
    return gpsAddress.value;
  }
  const known = origin.label.trim();
  if (known.length > 0) {
    return known;
  }
  return originAddress(origin, deps);
}
