import type { DirectoryCompany, DirectoryFacility, DirectoryUser } from "@groundops/contracts";
import { asc, eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  company,
  driver,
  driverCompany,
  driverMeterReading,
  driverTariff,
  facility,
  locationObservation,
  session,
  sortie,
  user,
  userCredential,
} from "../schema.js";

type DirectoryFailure = "invalid" | "missing" | "in-use";

export async function listCompanies(): Promise<DirectoryCompany[]> {
  const rows = await db
    .select({ id: company.id, name: company.name, createdAt: company.createdAt })
    .from(company)
    .orderBy(asc(company.name), asc(company.id));
  return rows.map(toNamed);
}

export async function createCompany(name: string): Promise<DirectoryCompany | "invalid"> {
  const trimmed = requiredName(name);
  if (!trimmed) {
    return "invalid";
  }
  const rows = await db
    .insert(company)
    .values({ name: trimmed })
    .returning({ id: company.id, name: company.name, createdAt: company.createdAt });
  const row = rows[0];
  if (!row) {
    throw new Error("company insert returned no row");
  }
  return toNamed(row);
}

export async function updateCompany(id: string, name: string): Promise<DirectoryCompany | DirectoryFailure> {
  const trimmed = requiredName(name);
  if (!trimmed) {
    return "invalid";
  }
  const rows = await db
    .update(company)
    .set({ name: trimmed })
    .where(eq(company.id, id))
    .returning({ id: company.id, name: company.name, createdAt: company.createdAt });
  const row = rows[0];
  return row ? toNamed(row) : "missing";
}

export async function deleteCompany(id: string): Promise<"ok" | "missing" | "in-use"> {
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: company.id }).from(company).where(eq(company.id, id)).limit(1);
    if (!existing[0]) {
      return "missing";
    }
    const linked = await tx
      .select({ id: driverCompany.id })
      .from(driverCompany)
      .where(eq(driverCompany.companyId, id))
      .limit(1);
    if (linked[0]) {
      return "in-use";
    }
    const used = await tx.select({ id: sortie.id }).from(sortie).where(eq(sortie.companyId, id)).limit(1);
    if (used[0]) {
      return "in-use";
    }
    await tx.delete(company).where(eq(company.id, id));
    return "ok";
  });
}

export async function listFacilities(): Promise<DirectoryFacility[]> {
  const rows = await db
    .select({ id: facility.id, name: facility.name, createdAt: facility.createdAt })
    .from(facility)
    .orderBy(asc(facility.name), asc(facility.id));
  return rows.map(toNamed);
}

export async function createFacility(name: string): Promise<DirectoryFacility | "invalid"> {
  const trimmed = requiredName(name);
  if (!trimmed) {
    return "invalid";
  }
  const rows = await db
    .insert(facility)
    .values({ name: trimmed })
    .returning({ id: facility.id, name: facility.name, createdAt: facility.createdAt });
  const row = rows[0];
  if (!row) {
    throw new Error("facility insert returned no row");
  }
  return toNamed(row);
}

export async function updateFacility(id: string, name: string): Promise<DirectoryFacility | DirectoryFailure> {
  const trimmed = requiredName(name);
  if (!trimmed) {
    return "invalid";
  }
  const rows = await db
    .update(facility)
    .set({ name: trimmed })
    .where(eq(facility.id, id))
    .returning({ id: facility.id, name: facility.name, createdAt: facility.createdAt });
  const row = rows[0];
  return row ? toNamed(row) : "missing";
}

export async function deleteFacility(id: string): Promise<"ok" | "missing"> {
  const rows = await db.delete(facility).where(eq(facility.id, id)).returning({ id: facility.id });
  return rows[0] ? "ok" : "missing";
}

export async function listUsers(): Promise<DirectoryUser[]> {
  const rows = await db
    .select({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(asc(user.displayName), asc(user.email), asc(user.id));
  return rows.map(toDirectoryUser);
}

export async function createDirectoryUser(
  displayName: string,
  email: string | null,
): Promise<DirectoryUser | "invalid"> {
  const name = requiredName(displayName);
  if (!name) {
    return "invalid";
  }
  const rows = await db
    .insert(user)
    .values({ displayName: name, email: optionalEmail(email) })
    .returning({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      createdAt: user.createdAt,
    });
  const row = rows[0];
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return toDirectoryUser(row);
}

export async function updateDirectoryUser(
  id: string,
  displayName: string,
  email: string | null,
): Promise<DirectoryUser | DirectoryFailure> {
  const name = requiredName(displayName);
  if (!name) {
    return "invalid";
  }
  const rows = await db
    .update(user)
    .set({ displayName: name, email: optionalEmail(email) })
    .where(eq(user.id, id))
    .returning({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      createdAt: user.createdAt,
    });
  const row = rows[0];
  return row ? toDirectoryUser(row) : "missing";
}

/** Removes a user who has no operational records. The signed-in administrator cannot remove themselves. */
export async function deleteDirectoryUser(callerId: string, userId: string): Promise<"ok" | "missing" | "in-use"> {
  if (callerId === userId) {
    return "in-use";
  }
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
    if (!existing[0]) {
      return "missing";
    }
    const drivers = await tx.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId)).limit(1);
    const driverRow = drivers[0];
    if (driverRow && (await driverHasOperations(tx, driverRow.id))) {
      return "in-use";
    }
    if (driverRow) {
      await tx.delete(driverCompany).where(eq(driverCompany.driverId, driverRow.id));
      await tx.delete(driver).where(eq(driver.id, driverRow.id));
    }
    await tx.delete(session).where(eq(session.userId, userId));
    await tx.delete(userCredential).where(eq(userCredential.userId, userId));
    await tx.delete(user).where(eq(user.id, userId));
    return "ok";
  });
}

async function driverHasOperations(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  driverId: string,
): Promise<boolean> {
  const sorties = await tx
    .select({ id: sortie.id })
    .from(sortie)
    .where(eq(sortie.authorDriverId, driverId))
    .limit(1);
  if (sorties[0]) {
    return true;
  }
  const fixes = await tx
    .select({ id: locationObservation.id })
    .from(locationObservation)
    .where(eq(locationObservation.driverId, driverId))
    .limit(1);
  if (fixes[0]) {
    return true;
  }
  const meters = await tx
    .select({ id: driverMeterReading.id })
    .from(driverMeterReading)
    .where(eq(driverMeterReading.driverId, driverId))
    .limit(1);
  if (meters[0]) {
    return true;
  }
  const tariffs = await tx
    .select({ id: driverTariff.id })
    .from(driverTariff)
    .where(eq(driverTariff.driverId, driverId))
    .limit(1);
  return Boolean(tariffs[0]);
}

function requiredName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalEmail(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNamed(row: { id: string; name: string; createdAt: Date }): DirectoryCompany {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

function toDirectoryUser(row: {
  id: string;
  displayName: string | null;
  email: string | null;
  createdAt: Date;
}): DirectoryUser {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  };
}
