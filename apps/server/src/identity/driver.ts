import type { Driver, User } from "@groundops/contracts";
import { asc, eq } from "drizzle-orm";
import { db } from "../db.js";
import { company, driver, driverCompany } from "../schema.js";

const fallbackCompanyName = "Company";

export type DriverDb = Pick<typeof db, "insert" | "select" | "update" | "delete">;

export function isUniqueViolation(error: unknown): boolean {
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
      administrator: true,
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

export async function findDriver(tx: DriverDb, userId: string): Promise<Driver | null> {
  const rows = await tx
    .select({ id: driver.id, userId: driver.userId })
    .from(driver)
    .where(eq(driver.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** The driver's earliest company link. Company creation time is the timestamp this table has. */
export async function findCompanyId(tx: DriverDb, driverId: string): Promise<string | null> {
  const rows = await tx
    .select({ companyId: driverCompany.companyId })
    .from(driverCompany)
    .innerJoin(company, eq(company.id, driverCompany.companyId))
    .where(eq(driverCompany.driverId, driverId))
    .orderBy(asc(company.createdAt), asc(driverCompany.id))
    .limit(1);
  return rows[0]?.companyId ?? null;
}

/** Removes the company link and the driver row. Callers delete dependent rows first. */
export async function deleteOwnedByDriver(tx: DriverDb, driverId: string): Promise<void> {
  await tx.delete(driverCompany).where(eq(driverCompany.driverId, driverId));
  await tx.delete(driver).where(eq(driver.id, driverId));
}
