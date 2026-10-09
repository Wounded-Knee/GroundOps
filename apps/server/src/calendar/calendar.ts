import {
  taskSortieType,
  type ActivityResponse,
  type Driver,
  type GeoCoordinate,
  type LocationFix,
  type Sortie,
  type SortieStop,
  type User,
} from "@groundops/contracts";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db.js";
import { locationUpdated, publishRealtime, sortieUpdated } from "../realtime.js";
import { computeDriveDuration, lookupAddress } from "../routing/google.js";
import { clearDriverMeter, readDriverMeter } from "./meterReading.js";
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
  distanceMeters,
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
const sortieCommenced = "sortie.commenced";
const sortieCompleted = "sortie.completed";
const sortieStopArrivalInferred = "sortie.stop_arrival_inferred";
const sortieStopArrivalAsserted = "sortie.stop_arrival_asserted";
const sortieStopDepartureInferred = "sortie.stop_departure_inferred";
/** Matches mobile guidance arrivalMeters. */
const stopArrivalMeters = 40;

export type SortieInput = {
  label: string;
  arrivalAt: Date | null;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: Array<Pick<SortieStop, "label" | "latitude" | "longitude" | "waitMinutes" | "passenger">>;
};

export type ObservationInput = {
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
  driveDuration: computeDriveDuration,
  lookupAddress,
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
  arrivalAuthored: boolean;
  actualStart: Date | null;
  actualEnd: Date | null;
  scheduleOriginLabel: string | null;
};

const sortieSelect = {
  id: sortie.id,
  label: sortie.label,
  arrivalAt: sortie.arrivalAt,
  arrivalAuthored: sortie.arrivalAuthored,
  scheduledStart: sortie.scheduledStart,
  scheduledEnd: sortie.scheduledEnd,
  actualStart: sortie.actualStart,
  actualEnd: sortie.actualEnd,
  scheduleOriginLabel: sortie.scheduleOriginLabel,
  passengerName: sortie.passengerName,
  passengerPhone: sortie.passengerPhone,
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
    .select(sortieSelect)
    .from(sortie)
    .where(
      and(
        eq(sortie.authorDriverId, author.id),
        or(
          and(isNotNull(sortie.actualStart), lt(sortie.actualStart, to)),
          and(isNull(sortie.actualStart), lt(sortie.scheduledStart, to)),
        ),
        or(
          and(isNotNull(sortie.actualEnd), gt(sortie.actualEnd, from)),
          and(isNull(sortie.actualEnd), gt(sortie.scheduledEnd, from)),
        ),
      ),
    )
    .orderBy(sql`coalesce(${sortie.actualStart}, ${sortie.scheduledStart})`, asc(sortie.id));

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
  const position = await departurePosition(author.id, null, valid.arrivalAt);
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
        arrivalAt: window.arrivalAt,
        arrivalAuthored: valid.arrivalAt !== null,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        scheduleOriginLatitude: position.latitude,
        scheduleOriginLongitude: position.longitude,
        scheduleOriginLabel: departureAddress,
        scheduleFailedAt: null,
        passengerName: valid.passengerName,
        passengerPhone: valid.passengerPhone,
      })
      .returning(sortieSelect);
    const row = inserted[0];
    if (!row) {
      throw new Error("sortie insert returned no row");
    }

    await writeStops(tx, row.id, valid.stops);
    await writeEvent(tx, sortieCreated, row, valid.stops);
    return toSortie(row, valid.stops);
  });
  if (typeof authored === "object") {
    await publishSortie(person.id, authored);
    await alignFollowingSorties(author.id, person.id, deps);
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
  const existingRows = await db
    .select(sortieSelect)
    .from(sortie)
    .where(and(eq(sortie.id, sortieId), eq(sortie.authorDriverId, author.id)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    return "not-found";
  }
  const previousStops = (await stopsBySortie(db, [sortieId])).get(sortieId) ?? [];
  const inProgress = existing.actualStart !== null && existing.actualEnd === null;
  const nextStops = mergeStopActuals(valid.stops, previousStops, inProgress);

  const position = await departurePosition(author.id, sortieId, valid.arrivalAt);
  if (!position) {
    return "no-location";
  }
  const window = await computeWindow(position, nextStops, valid.arrivalAt, deps.now(), deps.driveDuration);
  if (window === "failed") {
    return "unavailable";
  }
  const departureAddress = await originAddress(position, deps);

  const revised = await db.transaction(async (tx) => {
    const updated = await tx
      .update(sortie)
      .set({
        label: valid.label,
        arrivalAt: window.arrivalAt,
        arrivalAuthored: valid.arrivalAt !== null,
        scheduledStart: inProgress ? existing.scheduledStart : window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        actualStart: inProgress ? existing.actualStart : null,
        actualEnd: inProgress ? existing.actualEnd : null,
        scheduleOriginLatitude: position.latitude,
        scheduleOriginLongitude: position.longitude,
        scheduleOriginLabel: departureAddress,
        scheduleFailedAt: null,
        passengerName: valid.passengerName,
        passengerPhone: valid.passengerPhone,
      })
      .where(eq(sortie.id, sortieId))
      .returning(sortieSelect);
    const row = updated[0];
    if (!row) {
      return "not-found";
    }

    await tx.delete(sortieStop).where(eq(sortieStop.sortieId, sortieId));
    await writeStops(tx, row.id, nextStops);
    await writeEvent(tx, sortieRevised, row, nextStops);
    return toSortie(row, nextStops);
  });
  if (typeof revised === "object") {
    await publishSortie(person.id, revised);
    await alignFollowingSorties(author.id, person.id, deps);
  }
  return revised;
}

export async function assertStopArrival(
  person: User,
  sortieId: string,
  position: number,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<Sortie | "invalid" | "not-found" | "not-commenced"> {
  if (!Number.isInteger(position) || position < 0) {
    return "invalid";
  }
  const author = await findDriver(db, person.id);
  if (!author) {
    return "not-found";
  }
  const existing = await db
    .select(sortieSelect)
    .from(sortie)
    .where(and(eq(sortie.id, sortieId), eq(sortie.authorDriverId, author.id)))
    .limit(1);
  const row = existing[0];
  if (!row) {
    return "not-found";
  }
  if (row.actualStart === null) {
    return "not-commenced";
  }
  const stops = (await stopsBySortie(db, [row.id])).get(row.id) ?? [];
  const target = stops[position];
  if (!target) {
    return "invalid";
  }
  if (target.actualArrivedAt !== null) {
    return toSortie(row, stops);
  }
  const now = deps.now();
  const nextStops = stops.map((stop, index) =>
    index === position ? { ...stop, actualArrivedAt: now.toISOString() } : stop,
  );
  const asserted = await db.transaction(async (tx) => {
    await tx
      .update(sortieStop)
      .set({ actualArrivedAt: now })
      .where(and(eq(sortieStop.sortieId, sortieId), eq(sortieStop.position, position)));
    await writeEvent(tx, sortieStopArrivalAsserted, row, nextStops);
    return toSortie(row, nextStops);
  });
  await publishSortie(person.id, asserted);
  return asserted;
}

export async function extendStopWait(
  person: User,
  sortieId: string,
  position: number,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<Sortie | "invalid" | "not-found" | "no-location" | "unavailable"> {
  if (!Number.isInteger(position) || position < 0) {
    return "invalid";
  }
  const author = await findDriver(db, person.id);
  if (!author) {
    return "not-found";
  }
  const existing = await db
    .select(sortieSelect)
    .from(sortie)
    .where(and(eq(sortie.id, sortieId), eq(sortie.authorDriverId, author.id)))
    .limit(1);
  const row = existing[0];
  if (!row) {
    return "not-found";
  }
  const stops = (await stopsBySortie(db, [row.id])).get(row.id) ?? [];
  if (!stops[position]) {
    return "invalid";
  }
  const nextStops = stops.map((stop, index) =>
    index === position ? { ...stop, waitMinutes: stop.waitMinutes + 1 } : stop,
  );
  const origin = await departurePosition(author.id, sortieId, row.arrivalAuthored ? row.arrivalAt : null);
  if (!origin) {
    return "no-location";
  }
  const window = await computeWindow(origin, nextStops, row.arrivalAt, deps.now(), deps.driveDuration);
  if (window === "failed") {
    return "unavailable";
  }

  const revised = await db.transaction(async (tx) => {
    await tx
      .update(sortieStop)
      .set({ waitMinutes: nextStops[position]!.waitMinutes })
      .where(and(eq(sortieStop.sortieId, sortieId), eq(sortieStop.position, position)));
    const updated = await tx
      .update(sortie)
      .set({
        scheduledEnd: window.scheduledEnd,
        scheduleFailedAt: null,
      })
      .where(eq(sortie.id, sortieId))
      .returning(sortieSelect);
    const next = updated[0];
    if (!next) {
      return "not-found" as const;
    }
    return toSortie(next, nextStops);
  });
  if (typeof revised === "object") {
    await publishSortie(person.id, revised);
    await alignFollowingSorties(author.id, person.id, deps);
  }
  return revised;
}

export async function commenceSortie(
  person: User,
  sortieId: string,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<Sortie | "not-found" | "no-location" | "unavailable"> {
  const author = await findDriver(db, person.id);
  if (!author) {
    return "not-found";
  }
  const existing = await db
    .select(sortieSelect)
    .from(sortie)
    .where(and(eq(sortie.id, sortieId), eq(sortie.authorDriverId, author.id)))
    .limit(1);
  const row = existing[0];
  if (!row) {
    return "not-found";
  }
  const stops = (await stopsBySortie(db, [row.id])).get(row.id) ?? [];
  if (row.actualStart !== null) {
    return toSortie(row, stops);
  }

  const now = deps.now();
  const position = await departurePosition(author.id, row.id, row.arrivalAuthored ? row.arrivalAt : null);
  if (!position) {
    return "no-location";
  }
  const window = await computeWindow(
    position,
    stops,
    row.arrivalAuthored ? row.arrivalAt : null,
    now,
    deps.driveDuration,
  );
  if (window === "failed") {
    return "unavailable";
  }
  const departureAddress = await originAddress(position, deps);

  const commenced = await db.transaction(async (tx) => {
    const updated = await tx
      .update(sortie)
      .set({
        arrivalAt: window.arrivalAt,
        scheduledStart: row.arrivalAuthored ? row.scheduledStart : window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        actualStart: now,
        scheduleOriginLatitude: position.latitude,
        scheduleOriginLongitude: position.longitude,
        scheduleOriginLabel: departureAddress,
        scheduleFailedAt: null,
      })
      .where(eq(sortie.id, sortieId))
      .returning(sortieSelect);
    const next = updated[0];
    if (!next) {
      return "not-found" as const;
    }
    await writeEvent(tx, sortieCommenced, next, stops);
    return toSortie(next, stops);
  });
  if (typeof commenced === "object") {
    await publishSortie(person.id, commenced);
    await alignFollowingSorties(author.id, person.id, deps);
  }
  return commenced;
}

export async function completeSortie(
  person: User,
  sortieId: string,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<Sortie | "not-found" | "not-commenced"> {
  const author = await findDriver(db, person.id);
  if (!author) {
    return "not-found";
  }
  const existing = await db
    .select(sortieSelect)
    .from(sortie)
    .where(and(eq(sortie.id, sortieId), eq(sortie.authorDriverId, author.id)))
    .limit(1);
  const row = existing[0];
  if (!row) {
    return "not-found";
  }
  const stops = (await stopsBySortie(db, [row.id])).get(row.id) ?? [];
  if (row.actualStart === null) {
    return "not-commenced";
  }
  if (row.actualEnd !== null) {
    return toSortie(row, stops);
  }

  const now = deps.now();
  const completed = await db.transaction(async (tx) => {
    const nextStops = [...stops];
    const openIndex = nextStops.findIndex(
      (stop) => stop.actualArrivedAt !== null && stop.actualDepartedAt === null,
    );
    if (openIndex >= 0) {
      const open = nextStops[openIndex]!;
      nextStops[openIndex] = { ...open, actualDepartedAt: now.toISOString() };
      await tx
        .update(sortieStop)
        .set({ actualDepartedAt: now })
        .where(and(eq(sortieStop.sortieId, sortieId), eq(sortieStop.position, openIndex)));
      await writeEvent(tx, sortieStopDepartureInferred, row, nextStops);
    }

    const updated = await tx
      .update(sortie)
      .set({ actualEnd: now })
      .where(eq(sortie.id, sortieId))
      .returning(sortieSelect);
    const next = updated[0];
    if (!next) {
      return "not-found" as const;
    }
    await writeEvent(tx, sortieCompleted, next, nextStops);
    return toSortie(next, nextStops);
  });
  if (typeof completed === "object") {
    await publishSortie(person.id, completed);
    await clearDriverMeter(author.id, person.id);
  }
  return completed;
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

  const inProgress = await resolveInProgressSortie(author.id, input.sortieId ?? null);
  await db.insert(locationObservation).values({
    driverId: author.id,
    sortieId: inProgress?.id ?? null,
    observedAt: input.observedAt,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
  });
  await publishRealtime(
    locationUpdated(person.id, {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      observedAt: input.observedAt.toISOString(),
    }),
  );
  if (inProgress) {
    await inferStopActuals(person.id, inProgress, {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      observedAt: input.observedAt,
    });
  }
  await recomputeOpenSorties(author.id, person.id, { latitude: input.latitude, longitude: input.longitude }, deps);
  return "ok";
}

async function recomputeOpenSorties(
  driverId: string,
  userId: string,
  position: GeoCoordinate,
  deps: ScheduleDeps,
): Promise<void> {
  const now = deps.now();
  const rows = await openSorties(driverId, now);

  const places = await driverPlaces(driverId);
  for (const row of rows) {
    if (row.actualStart !== null) {
      continue;
    }
    if (approachOrigin(places, row.arrivalAt, row.id, null) !== null) {
      continue;
    }
    await recomputeFrom(userId, row, { ...position, label: null }, now, deps, true);
  }
}

async function alignFollowingSorties(driverId: string, userId: string, deps: ScheduleDeps): Promise<void> {
  const now = deps.now();
  const gps = await latestObservation(db, driverId);
  const places = await driverPlaces(driverId);
  const rows = await openSorties(driverId, now);
  for (const row of rows) {
    if (row.actualStart !== null) {
      continue;
    }
    const origin = approachOrigin(places, row.arrivalAt, row.id, gps);
    if (!origin) {
      continue;
    }
    await recomputeFrom(userId, row, origin, now, deps, false);
  }
}

async function recomputeFrom(
  userId: string,
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

  if (!row.arrivalAuthored && position.label !== null) {
    return;
  }

  const stops = (await stopsBySortie(db, [row.id])).get(row.id) ?? [];
  const window = await computeWindow(
    position,
    stops,
    row.arrivalAuthored ? row.arrivalAt : null,
    now,
    deps.driveDuration,
  );
  if (window === "failed") {
    await db.update(sortie).set({ scheduleFailedAt: now }).where(eq(sortie.id, row.id));
    return;
  }
  const address = await originAddress(position, deps);

  await db.transaction(async (tx) => {
    await tx
      .update(sortie)
      .set({
        arrivalAt: window.arrivalAt,
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
        arrivalAt: window.arrivalAt,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        passengerName: row.passengerName,
        passengerPhone: row.passengerPhone,
      },
      stops,
    );
  });
  await publishSortie(
    userId,
    toSortie(
      {
        ...row,
        arrivalAt: window.arrivalAt,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        scheduleOriginLabel: address,
      },
      stops,
    ),
  );
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
      waitMinutes: stop.waitMinutes,
      passenger: stop.passenger,
      actualArrivedAt: stop.actualArrivedAt ? new Date(stop.actualArrivedAt) : null,
      actualDepartedAt: stop.actualDepartedAt ? new Date(stop.actualDepartedAt) : null,
    })),
  );
}

function mergeStopActuals(next: SortieStop[], previous: SortieStop[], inProgress: boolean): SortieStop[] {
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

async function resolveInProgressSortie(
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

async function inferStopActuals(
  userId: string,
  inProgress: StoredSortie,
  fix: { latitude: number; longitude: number; accuracyMeters: number | null; observedAt: Date },
): Promise<void> {
  const stopRows = await db
    .select({
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
    .where(eq(sortieStop.sortieId, inProgress.id))
    .orderBy(asc(sortieStop.position));
  if (stopRows.length === 0) {
    return;
  }

  const threshold = geofenceMeters(fix.accuracyMeters);
  const stops: SortieStop[] = stopRows.map((row) => ({
    label: row.label,
    latitude: row.latitude,
    longitude: row.longitude,
    waitMinutes: row.waitMinutes,
    passenger: row.passenger,
    actualArrivedAt: row.actualArrivedAt ? row.actualArrivedAt.toISOString() : null,
    actualDepartedAt: row.actualDepartedAt ? row.actualDepartedAt.toISOString() : null,
  }));

  for (let index = 0; index < stopRows.length; index += 1) {
    const row = stopRows[index]!;
    const place = { latitude: row.latitude, longitude: row.longitude };
    const meters = distanceMeters(fix, place);

    if (row.actualArrivedAt === null) {
      if (meters <= threshold) {
        const nextStops = stops.map((stop, stopIndex) =>
          stopIndex === index ? { ...stop, actualArrivedAt: fix.observedAt.toISOString() } : stop,
        );
        await db.transaction(async (tx) => {
          await tx
            .update(sortieStop)
            .set({ actualArrivedAt: fix.observedAt })
            .where(and(eq(sortieStop.sortieId, inProgress.id), eq(sortieStop.position, index)));
          await writeEvent(tx, sortieStopArrivalInferred, inProgress, nextStops);
        });
        await publishSortie(userId, toSortie(inProgress, nextStops));
      }
      return;
    }

    if (row.actualDepartedAt === null) {
      if (meters > threshold) {
        const nextStops = stops.map((stop, stopIndex) =>
          stopIndex === index ? { ...stop, actualDepartedAt: fix.observedAt.toISOString() } : stop,
        );
        await db.transaction(async (tx) => {
          await tx
            .update(sortieStop)
            .set({ actualDepartedAt: fix.observedAt })
            .where(and(eq(sortieStop.sortieId, inProgress.id), eq(sortieStop.position, index)));
          await writeEvent(tx, sortieStopDepartureInferred, inProgress, nextStops);
        });
        await publishSortie(userId, toSortie(inProgress, nextStops));
      }
      return;
    }
  }
}

function geofenceMeters(accuracyMeters: number | null): number {
  if (accuracyMeters === null || !Number.isFinite(accuracyMeters)) {
    return stopArrivalMeters;
  }
  return Math.max(stopArrivalMeters, accuracyMeters);
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

async function departurePosition(
  driverId: string,
  sortieId: string | null,
  arrivalAt: Date | null,
): Promise<ApproachOrigin | null> {
  const gps = await latestObservation(db, driverId);
  if (arrivalAt === null) {
    if (!gps) {
      return null;
    }
    return { ...gps, label: null };
  }
  const places = await driverPlaces(driverId);
  return approachOrigin(places, arrivalAt, sortieId, gps);
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
      arrivalAuthored: sortie.arrivalAuthored,
      scheduledStart: sortie.scheduledStart,
      scheduledEnd: sortie.scheduledEnd,
      actualStart: sortie.actualStart,
      actualEnd: sortie.actualEnd,
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

export async function readActivity(person: User): Promise<ActivityResponse> {
  const asOf = new Date().toISOString();
  const author = await findDriver(db, person.id);
  if (!author) {
    return { asOf, location: null, sortie: null, meter: null };
  }
  const location = await latestFix(author.id);
  const inProgress = await resolveInProgressSortie(author.id, null);
  const stops = inProgress ? ((await stopsBySortie(db, [inProgress.id])).get(inProgress.id) ?? []) : [];
  return {
    asOf,
    location,
    sortie: inProgress ? toSortie(inProgress, stops) : null,
    meter: await readDriverMeter(author.id),
  };
}

async function latestFix(driverId: string): Promise<LocationFix | null> {
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

async function publishSortie(userId: string, sortie: Sortie): Promise<void> {
  await publishRealtime(sortieUpdated(userId, sortie));
}

function toSortie(row: StoredSortie, stops: SortieStop[]): Sortie {
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
