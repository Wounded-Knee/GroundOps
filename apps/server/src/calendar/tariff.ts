import { defaultTariff, type Tariff, type User } from "@groundops/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { driver, driverTariff } from "../schema.js";

/** Reads the driver's tariff, inserting defaults when none exists. */
export async function readTariff(person: User): Promise<Tariff | "no-driver"> {
  const author = await findDriverId(person.id);
  if (!author) {
    return "no-driver";
  }
  const existing = await db
    .select({
      flagCents: driverTariff.flagCents,
      perMileCents: driverTariff.perMileCents,
      perWaitMinuteCents: driverTariff.perWaitMinuteCents,
    })
    .from(driverTariff)
    .where(eq(driverTariff.driverId, author))
    .limit(1);
  const row = existing[0];
  if (row) {
    return row;
  }
  await db.insert(driverTariff).values({
    driverId: author,
    flagCents: defaultTariff.flagCents,
    perMileCents: defaultTariff.perMileCents,
    perWaitMinuteCents: defaultTariff.perWaitMinuteCents,
  });
  return { ...defaultTariff };
}

/** Replaces the driver's tariff. Creates the row when none exists. */
export async function replaceTariff(
  person: User,
  tariff: Tariff,
): Promise<Tariff | "no-driver" | "invalid"> {
  if (!isValidTariff(tariff)) {
    return "invalid";
  }
  const author = await findDriverId(person.id);
  if (!author) {
    return "no-driver";
  }
  const existing = await db
    .select({ id: driverTariff.id })
    .from(driverTariff)
    .where(eq(driverTariff.driverId, author))
    .limit(1);
  if (existing[0]) {
    await db
      .update(driverTariff)
      .set({
        flagCents: tariff.flagCents,
        perMileCents: tariff.perMileCents,
        perWaitMinuteCents: tariff.perWaitMinuteCents,
      })
      .where(eq(driverTariff.driverId, author));
  } else {
    await db.insert(driverTariff).values({
      driverId: author,
      flagCents: tariff.flagCents,
      perMileCents: tariff.perMileCents,
      perWaitMinuteCents: tariff.perWaitMinuteCents,
    });
  }
  return tariff;
}

export function isValidTariff(value: Tariff): boolean {
  return isMoneyCents(value.flagCents) && isMoneyCents(value.perMileCents) && isMoneyCents(value.perWaitMinuteCents);
}

function isMoneyCents(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

async function findDriverId(userId: string): Promise<string | null> {
  const rows = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId)).limit(1);
  return rows[0]?.id ?? null;
}
