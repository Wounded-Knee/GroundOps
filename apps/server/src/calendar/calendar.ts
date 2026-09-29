import {
  taskSortieType,
  type Driver,
  type GeoCoordinate,
  type Sortie,
  type SortieStop,
  type User,
} from "@groundops/contracts";
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "../db.js";
import { computeDriveDuration, lookupAddress } from "../routing/google.js";
import {
  company,
  driver,
  driverCompany,
  locationObservation,
  operationalEvent,
  sortie,
  sortieStop,
} from "../schema.js";
import {
  approachOrigin,
  computeWindow,
  movedFarEnough,
  scheduleBackoffMs,
  type ApproachOrigin,
  type DriveDuration,
  type SortiePlace,
} from "./schedule.js";

const fallbackCompanyName = "Company";
const sortieCreated = "sortie.created";
const sortieRevised = "sortie.revised";
const sortieScheduleComputed = "sortie.schedule_computed";

export type SortieInput = {
  label: string;
  arrivalAt: Date;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: SortieStop[];
};

export type ObservationInput = {
  observedAt: Date;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
};

export type ScheduleDeps = {
  driveDuration: DriveDuration;
  lookupAddress?: (position: GeoCoordinate) => Promise<string | null>;
  now: () => Date;
};

export const defaultScheduleDeps: ScheduleDeps = {
  driveDuration: computeDriveDuration,
  lookupAddress,
  now: () => new Date(),
};

type ValidSortie = {
  label: string;
  arrivalAt: Date;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: SortieStop[];
};

type Database = Pick<typeof db, "insert" | "select" | "update" | "delete">;

type SortieRow = {
  id: string;
  label: string;
  arrivalAt: Date;
  scheduledStart: Date;
  scheduledEnd: Date;
  passengerName: string | null;
  passengerPhone: string | null;
};

type StoredSortie = SortieRow & {
  scheduleOriginLabel: string | null;
};

type OpenSortie = StoredSortie & {
  scheduleOriginLatitude: number | null;
  scheduleOriginLongitude: number | null;
  scheduleFailedAt: Date | null;
};

/** Finds the user's driver, or creates the driver, company, and relationship together. */
export async function ensureDriver(person: User): Promise<Driver> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await insertDriver(person);
    } catch (error) {
      if (attempt === 0 && isUniqueViolation(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("driver creation failed");
}

export async function readCalendar(
  person: User,
  from: Date,
  to: Date,
): Promise<Sortie[] | "no-driver" | "invalid-range"> {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() >= to.getTime()) {
    return "invalid-range";
  }

  const author = await findDriver(db, person.id);
  if (!author) {
    return "no-driver";
  }

  const rows = await db
    .select({
      id: sortie.id,
      label: sortie.label,
      arrivalAt: sortie.arrivalAt,
      scheduledStart: sortie.scheduledStart,
      scheduledEnd: sortie.scheduledEnd,
      scheduleOriginLabel: sortie.scheduleOriginLabel,
      passengerName: sortie.passengerName,
      passengerPhone: sortie.passengerPhone,
    })
    .from(sortie)
    .where(
      and(eq(sortie.authorDriverId, author.id), lt(sortie.scheduledStart, to), gt(sortie.scheduledEnd, from)),
    )
    .orderBy(asc(sortie.scheduledStart), asc(sortie.id));

  const stops = await stopsBySortie(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toSortie(row, stops.get(row.id) ?? []));
}

export async function authorSortie(
  person: User,
  input: SortieInput,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<Sortie | "no-driver" | "invalid" | "no-location" | "unavailable"> {
  const valid = validSortie(input);
  if (!valid) {
    return "invalid";
  }

  const author = await findDriver(db, person.id);
  if (!author) {
    return "no-driver";
  }
  const companyId = await findCompanyId(db, author.id);
  if (!companyId) {
    return "no-driver";
  }
  const position = await approachPosition(author.id, null, valid.arrivalAt);
  if (!position) {
    return "no-location";
  }
  const window = await computeWindow(position, valid.stops, valid.arrivalAt, deps.now(), deps.driveDuration);
  if (window === "failed") {
    return "unavailable";
  }
  const departureAddress = await originAddress(position, deps);

  const authored = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(sortie)
      .values({
        companyId,
        authorDriverId: author.id,
        type: taskSortieType,
        label: valid.label,
        arrivalAt: valid.arrivalAt,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        scheduleOriginLatitude: position.latitude,
        scheduleOriginLongitude: position.longitude,
        scheduleOriginLabel: departureAddress,
        scheduleFailedAt: null,
        passengerName: valid.passengerName,
        passengerPhone: valid.passengerPhone,
      })
      .returning({
        id: sortie.id,
        label: sortie.label,
        arrivalAt: sortie.arrivalAt,
        scheduledStart: sortie.scheduledStart,
        scheduledEnd: sortie.scheduledEnd,
        scheduleOriginLabel: sortie.scheduleOriginLabel,
        passengerName: sortie.passengerName,
        passengerPhone: sortie.passengerPhone,
      });
    const row = inserted[0];
    if (!row) {
      throw new Error("sortie insert returned no row");
    }

    await writeStops(tx, row.id, valid.stops);
    await writeEvent(tx, sortieCreated, row, valid.stops);
    return toSortie(row, valid.stops);
  });
  if (typeof authored === "object") {
    await alignFollowingSorties(author.id, deps);
  }
  return authored;
}

export async function reviseSortie(
  person: User,
  sortieId: string,
  input: SortieInput,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<Sortie | "invalid" | "not-found" | "no-location" | "unavailable"> {
  const valid = validSortie(input);
  if (!valid) {
    return "invalid";
  }

  const author = await findDriver(db, person.id);
  if (!author) {
    return "not-found";
  }
  const existing = await db
    .select({ id: sortie.id })
    .from(sortie)
    .where(and(eq(sortie.id, sortieId), eq(sortie.authorDriverId, author.id)))
    .limit(1);
  if (!existing[0]) {
    return "not-found";
  }
  const position = await approachPosition(author.id, sortieId, valid.arrivalAt);
  if (!position) {
    return "no-location";
  }
  const window = await computeWindow(position, valid.stops, valid.arrivalAt, deps.now(), deps.driveDuration);
  if (window === "failed") {
    return "unavailable";
  }
  const departureAddress = await originAddress(position, deps);

  const revised = await db.transaction(async (tx) => {
    const updated = await tx
      .update(sortie)
      .set({
        label: valid.label,
        arrivalAt: valid.arrivalAt,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        scheduleOriginLatitude: position.latitude,
        scheduleOriginLongitude: position.longitude,
        scheduleOriginLabel: departureAddress,
        scheduleFailedAt: null,
        passengerName: valid.passengerName,
        passengerPhone: valid.passengerPhone,
      })
      .where(eq(sortie.id, sortieId))
      .returning({
        id: sortie.id,
        label: sortie.label,
        arrivalAt: sortie.arrivalAt,
        scheduledStart: sortie.scheduledStart,
        scheduledEnd: sortie.scheduledEnd,
        scheduleOriginLabel: sortie.scheduleOriginLabel,
        passengerName: sortie.passengerName,
        passengerPhone: sortie.passengerPhone,
      });
    const row = updated[0];
    if (!row) {
      return "not-found";
    }

    await tx.delete(sortieStop).where(eq(sortieStop.sortieId, sortieId));
    await writeStops(tx, row.id, valid.stops);
    await writeEvent(tx, sortieRevised, row, valid.stops);
    return toSortie(row, valid.stops);
  });
  if (typeof revised === "object") {
    await alignFollowingSorties(author.id, deps);
  }
  return revised;
}

export async function recordObservation(
  person: User,
  input: ObservationInput,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<"ok" | "no-driver" | "invalid"> {
  if (!validObservation(input)) {
    return "invalid";
  }
  const author = await findDriver(db, person.id);
  if (!author) {
    return "no-driver";
  }

  await db.insert(locationObservation).values({
    driverId: author.id,
    observedAt: input.observedAt,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
  });
  await recomputeOpenSorties(author.id, { latitude: input.latitude, longitude: input.longitude }, deps);
  return "ok";
}

async function recomputeOpenSorties(driverId: string, position: GeoCoordinate, deps: ScheduleDeps): Promise<void> {
  const now = deps.now();
  const rows = await openSorties(driverId, now);

  const places = await driverPlaces(driverId);
  for (const row of rows) {
    if (approachOrigin(places, row.arrivalAt, row.id, null) !== null) {
      continue;
    }
    await recomputeFrom(row, { ...position, label: null }, now, deps, true);
  }
}

async function alignFollowingSorties(driverId: string, deps: ScheduleDeps): Promise<void> {
  const now = deps.now();
  const gps = await latestObservation(db, driverId);
  const places = await driverPlaces(driverId);
  const rows = await openSorties(driverId, now);
  for (const row of rows) {
    const origin = approachOrigin(places, row.arrivalAt, row.id, gps);
    if (!origin) {
      continue;
    }
    await recomputeFrom(row, origin, now, deps, false);
  }
}

async function recomputeFrom(
  row: OpenSortie,
  position: ApproachOrigin,
  now: Date,
  deps: ScheduleDeps,
  requireMovement: boolean,
): Promise<void> {
  const anchor = anchorOf(row);
  if (requireMovement) {
    if (anchor && !movedFarEnough(anchor, position)) {
      return;
    }
  } else if (anchor && samePlace(anchor, position)) {
    const address = await originAddress(position, deps);
    if (row.scheduleOriginLabel !== address) {
      await db.update(sortie).set({ scheduleOriginLabel: address }).where(eq(sortie.id, row.id));
    }
    return;
  }
  if (row.scheduleFailedAt && now.getTime() - row.scheduleFailedAt.getTime() < scheduleBackoffMs) {
    return;
  }

  const stops = (await stopsBySortie(db, [row.id])).get(row.id) ?? [];
  if (stops.length < 2) {
    return;
  }
  const window = await computeWindow(position, stops, row.arrivalAt, now, deps.driveDuration);
  if (window === "failed") {
    await db.update(sortie).set({ scheduleFailedAt: now }).where(eq(sortie.id, row.id));
    return;
  }
  const address = await originAddress(position, deps);

  await db.transaction(async (tx) => {
    await tx
      .update(sortie)
      .set({
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        scheduleOriginLatitude: position.latitude,
        scheduleOriginLongitude: position.longitude,
        scheduleOriginLabel: address,
        scheduleFailedAt: null,
      })
      .where(eq(sortie.id, row.id));
    await writeEvent(
      tx,
      sortieScheduleComputed,
      {
        id: row.id,
        label: row.label,
        arrivalAt: row.arrivalAt,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        passengerName: row.passengerName,
        passengerPhone: row.passengerPhone,
      },
      stops,
    );
  });
}

async function insertDriver(person: User): Promise<Driver> {
  return db.transaction(async (tx) => {
    const existing = await findDriver(tx, person.id);
    if (existing) {
      return existing;
    }

    const companies = await tx
      .insert(company)
      .values({ name: companyName(person) })
      .returning({ id: company.id });
    const createdCompany = companies[0];
    if (!createdCompany) {
      throw new Error("company insert returned no row");
    }

    const drivers = await tx
      .insert(driver)
      .values({ userId: person.id })
      .returning({ id: driver.id, userId: driver.userId });
    const createdDriver = drivers[0];
    if (!createdDriver) {
      throw new Error("driver insert returned no row");
    }

    await tx.insert(driverCompany).values({
      driverId: createdDriver.id,
      companyId: createdCompany.id,
    });
    return createdDriver;
  });
}

function companyName(person: User): string {
  const displayName = person.displayName?.trim() ?? "";
  if (displayName.length > 0) {
    return displayName;
  }
  const email = person.email?.trim() ?? "";
  if (email.length > 0) {
    return email;
  }
  return fallbackCompanyName;
}

function validSortie(input: SortieInput): ValidSortie | null {
  if (Number.isNaN(input.arrivalAt.getTime())) {
    return null;
  }
  const label = input.label.trim();
  if (label.length === 0) {
    return null;
  }

  const passengerName = blankToNull(input.passengerName);
  const passengerPhone = blankToNull(input.passengerPhone);
  if (passengerPhone !== null && !/^\d{10}$/.test(passengerPhone)) {
    return null;
  }

  if (input.stops.length < 2) {
    return null;
  }
  const stops: SortieStop[] = [];
  for (const stop of input.stops) {
    const stopLabel = stop.label.trim();
    if (stopLabel.length === 0 || !Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) {
      return null;
    }
    stops.push({ label: stopLabel, latitude: stop.latitude, longitude: stop.longitude });
  }
  return {
    label,
    arrivalAt: input.arrivalAt,
    passengerName,
    passengerPhone,
    stops,
  };
}

function validObservation(input: ObservationInput): boolean {
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

function anchorOf(row: OpenSortie): GeoCoordinate | null {
  if (row.scheduleOriginLatitude === null || row.scheduleOriginLongitude === null) {
    return null;
  }
  return { latitude: row.scheduleOriginLatitude, longitude: row.scheduleOriginLongitude };
}

async function writeStops(tx: Database, sortieId: string, stops: SortieStop[]): Promise<void> {
  await tx.insert(sortieStop).values(
    stops.map((stop, position) => ({
      sortieId,
      position,
      label: stop.label,
      latitude: stop.latitude,
      longitude: stop.longitude,
    })),
  );
}

async function writeEvent(tx: Database, type: string, row: SortieRow, stops: SortieStop[]): Promise<void> {
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

async function stopsBySortie(tx: Database, sortieIds: string[]): Promise<Map<string, SortieStop[]>> {
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
    })
    .from(sortieStop)
    .where(inArray(sortieStop.sortieId, sortieIds))
    .orderBy(asc(sortieStop.position));
  for (const row of rows) {
    const list = grouped.get(row.sortieId) ?? [];
    list.push({ label: row.label, latitude: row.latitude, longitude: row.longitude });
    grouped.set(row.sortieId, list);
  }
  return grouped;
}

async function approachPosition(
  driverId: string,
  sortieId: string | null,
  arrivalAt: Date,
): Promise<ApproachOrigin | null> {
  const places = await driverPlaces(driverId);
  return approachOrigin(places, arrivalAt, sortieId, await latestObservation(db, driverId));
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

async function openSorties(driverId: string, now: Date): Promise<OpenSortie[]> {
  return db
    .select({
      id: sortie.id,
      label: sortie.label,
      arrivalAt: sortie.arrivalAt,
      scheduledStart: sortie.scheduledStart,
      scheduledEnd: sortie.scheduledEnd,
      passengerName: sortie.passengerName,
      passengerPhone: sortie.passengerPhone,
      scheduleOriginLatitude: sortie.scheduleOriginLatitude,
      scheduleOriginLongitude: sortie.scheduleOriginLongitude,
      scheduleOriginLabel: sortie.scheduleOriginLabel,
      scheduleFailedAt: sortie.scheduleFailedAt,
    })
    .from(sortie)
    .where(and(eq(sortie.authorDriverId, driverId), gt(sortie.scheduledEnd, now)));
}

async function driverPlaces(driverId: string): Promise<SortiePlace[]> {
  const rows = await db
    .select({
      id: sortie.id,
      arrivalAt: sortie.arrivalAt,
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
    places.push({ id: row.id, arrivalAt: row.arrivalAt, destination, destinationLabel: row.label });
  }
  return places;
}

function samePlace(left: GeoCoordinate, right: GeoCoordinate): boolean {
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

async function latestObservation(tx: Database, driverId: string): Promise<GeoCoordinate | null> {
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

async function findDriver(tx: Database, userId: string): Promise<Driver | null> {
  const rows = await tx
    .select({ id: driver.id, userId: driver.userId })
    .from(driver)
    .where(eq(driver.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

async function findCompanyId(tx: Database, driverId: string): Promise<string | null> {
  const rows = await tx
    .select({ companyId: driverCompany.companyId })
    .from(driverCompany)
    .where(eq(driverCompany.driverId, driverId))
    .limit(1);
  return rows[0]?.companyId ?? null;
}

function toSortie(row: StoredSortie, stops: SortieStop[]): Sortie {
  return {
    id: row.id,
    type: taskSortieType,
    label: row.label,
    arrivalAt: row.arrivalAt.toISOString(),
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    departureAddress: row.scheduleOriginLabel ?? "",
    passengerName: row.passengerName,
    passengerPhone: row.passengerPhone,
    stops,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ("code" in error && error.code === "23505") {
    return true;
  }
  if ("cause" in error) {
    return isUniqueViolation(error.cause);
  }
  return false;
}
