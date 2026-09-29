import {
  taskSortieType,
  type Driver,
  type Sortie,
  type SortieStop,
  type User,
} from "@groundops/contracts";
import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "../db.js";
import { company, driver, driverCompany, operationalEvent, sortie, sortieStop } from "../schema.js";

const fallbackCompanyName = "Company";
const sortieCreated = "sortie.created";
const sortieRevised = "sortie.revised";

export type SortieInput = {
  label: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: SortieStop[];
};

type ValidSortie = {
  label: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: SortieStop[];
};

type Database = Pick<typeof db, "insert" | "select" | "update" | "delete">;

type SortieRow = {
  id: string;
  label: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  passengerName: string | null;
  passengerPhone: string | null;
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
      scheduledStart: sortie.scheduledStart,
      scheduledEnd: sortie.scheduledEnd,
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
): Promise<Sortie | "no-driver" | "invalid"> {
  const valid = validSortie(input);
  if (!valid) {
    return "invalid";
  }

  return db.transaction(async (tx) => {
    const author = await findDriver(tx, person.id);
    if (!author) {
      return "no-driver";
    }
    const companyId = await findCompanyId(tx, author.id);
    if (!companyId) {
      return "no-driver";
    }

    const inserted = await tx
      .insert(sortie)
      .values({
        companyId,
        authorDriverId: author.id,
        type: taskSortieType,
        label: valid.label,
        scheduledStart: valid.scheduledStart,
        scheduledEnd: valid.scheduledEnd,
        passengerName: valid.passengerName,
        passengerPhone: valid.passengerPhone,
      })
      .returning({
        id: sortie.id,
        label: sortie.label,
        scheduledStart: sortie.scheduledStart,
        scheduledEnd: sortie.scheduledEnd,
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
}

export async function reviseSortie(
  person: User,
  sortieId: string,
  input: SortieInput,
): Promise<Sortie | "invalid" | "not-found"> {
  const valid = validSortie(input);
  if (!valid) {
    return "invalid";
  }

  return db.transaction(async (tx) => {
    const author = await findDriver(tx, person.id);
    if (!author) {
      return "not-found";
    }

    const existing = await tx
      .select({ id: sortie.id })
      .from(sortie)
      .where(and(eq(sortie.id, sortieId), eq(sortie.authorDriverId, author.id)))
      .limit(1);
    if (!existing[0]) {
      return "not-found";
    }

    const updated = await tx
      .update(sortie)
      .set({
        label: valid.label,
        scheduledStart: valid.scheduledStart,
        scheduledEnd: valid.scheduledEnd,
        passengerName: valid.passengerName,
        passengerPhone: valid.passengerPhone,
      })
      .where(eq(sortie.id, sortieId))
      .returning({
        id: sortie.id,
        label: sortie.label,
        scheduledStart: sortie.scheduledStart,
        scheduledEnd: sortie.scheduledEnd,
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
  if (Number.isNaN(input.scheduledStart.getTime()) || Number.isNaN(input.scheduledEnd.getTime())) {
    return null;
  }
  const label = input.label.trim();
  if (label.length === 0 || input.scheduledStart.getTime() >= input.scheduledEnd.getTime()) {
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
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    passengerName,
    passengerPhone,
    stops,
  };
}

function blankToNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
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

function toSortie(row: SortieRow, stops: SortieStop[]): Sortie {
  return {
    id: row.id,
    type: taskSortieType,
    label: row.label,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
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
