import type { DirectoryCompany, DirectoryFacility, DirectoryMember, DirectoryUser } from "@groundops/contracts";
import { and, asc, eq, inArray } from "drizzle-orm";
import { deleteOwnedByDriver as deleteAddressBookOwnedByDriver } from "../addressBook/addressBook.js";
import { deleteOwnedByDriver as deleteAvailabilityOwnedByDriver } from "../availability/availability.js";
import { deleteOwnedByDriver as deleteSortieOwnedByDriver, driverHasOperationalRecords } from "../calendar/owned.js";
import { db } from "../db.js";
import { deleteOwnedByDriver as deleteDriverOwnedByDriver } from "../identity/driver.js";
import {
  addressBookCompanyShare,
  company,
  driver,
  driverCompany,
  facility,
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
    await tx.delete(addressBookCompanyShare).where(eq(addressBookCompanyShare.companyId, id));
    await tx.delete(company).where(eq(company.id, id));
    return "ok";
  });
}

export async function listCompanyMembers(companyId: string): Promise<DirectoryMember[] | "missing"> {
  const existing = await db.select({ id: company.id }).from(company).where(eq(company.id, companyId)).limit(1);
  if (!existing[0]) {
    return "missing";
  }
  const rows = await db
    .select({
      userId: user.id,
      displayName: user.displayName,
      email: user.email,
      administrator: driverCompany.administrator,
    })
    .from(driverCompany)
    .innerJoin(driver, eq(driver.id, driverCompany.driverId))
    .innerJoin(user, eq(user.id, driver.userId))
    .where(eq(driverCompany.companyId, companyId))
    .orderBy(asc(user.displayName), asc(user.email), asc(user.id));
  return rows;
}

/** Links a user to a company. A user who is not yet a driver gets a driver row and no personal company. */
export async function putCompanyMember(
  companyId: string,
  userId: string,
  administrator: boolean,
): Promise<DirectoryMember | "missing"> {
  return db.transaction(async (tx) => {
    const companies = await tx.select({ id: company.id }).from(company).where(eq(company.id, companyId)).limit(1);
    if (!companies[0]) {
      return "missing";
    }
    const people = await tx
      .select({ id: user.id, displayName: user.displayName, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    const person = people[0];
    if (!person) {
      return "missing";
    }
    const drivers = await tx.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId)).limit(1);
    let driverId = drivers[0]?.id;
    if (!driverId) {
      const created = await tx.insert(driver).values({ userId }).returning({ id: driver.id });
      driverId = created[0]?.id;
      if (!driverId) {
        throw new Error("driver insert returned no row");
      }
    }
    const existing = await tx
      .select({ id: driverCompany.id })
      .from(driverCompany)
      .where(and(eq(driverCompany.driverId, driverId), eq(driverCompany.companyId, companyId)))
      .limit(1);
    if (existing[0]) {
      await tx.update(driverCompany).set({ administrator }).where(eq(driverCompany.id, existing[0].id));
    } else {
      await tx.insert(driverCompany).values({ driverId, companyId, administrator });
    }
    return {
      userId: person.id,
      displayName: person.displayName,
      email: person.email,
      administrator,
    };
  });
}

/** Removes the company link. The driver row stays. */
export async function deleteCompanyMember(companyId: string, userId: string): Promise<"ok" | "missing"> {
  return db.transaction(async (tx) => {
    const companies = await tx.select({ id: company.id }).from(company).where(eq(company.id, companyId)).limit(1);
    if (!companies[0]) {
      return "missing";
    }
    const drivers = await tx.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId)).limit(1);
    const driverRow = drivers[0];
    if (!driverRow) {
      return "missing";
    }
    const removed = await tx
      .delete(driverCompany)
      .where(and(eq(driverCompany.driverId, driverRow.id), eq(driverCompany.companyId, companyId)))
      .returning({ id: driverCompany.id });
    return removed.length === 0 ? "missing" : "ok";
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
    if (driverRow && (await driverHasOperationalRecords(tx, driverRow.id))) {
      return "in-use";
    }
    if (driverRow) {
      await deleteSortieOwnedByDriver(tx, driverRow.id);
      await deleteAddressBookOwnedByDriver(tx, driverRow.id);
      await deleteAvailabilityOwnedByDriver(tx, driverRow.id);
      await deleteDriverOwnedByDriver(tx, driverRow.id);
    }
    await tx.delete(session).where(eq(session.userId, userId));
    await tx.delete(userCredential).where(eq(userCredential.userId, userId));
    await tx.delete(user).where(eq(user.id, userId));
    return "ok";
  });
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
