import { defaultTariff, type Tariff, type User } from "@groundops/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { findDriver } from "../identity/driver.js";
import { driverTariff } from "../schema.js";

/** Reads the driver's tariff, inserting defaults when none exists. */
export async function readTariff(person: User): Promise<Tariff | "no-driver"> {
  const author = await findDriver(db, person.id);
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
    .where(eq(driverTariff.driverId, author.id))
    .limit(1);
  const row = existing[0];
  if (row) {
    return row;
  }
  await db.insert(driverTariff).values({
    driverId: author.id,
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
): Promise<Tariff | "no-driver"> {
  const author = await findDriver(db, person.id);
  if (!author) {
    return "no-driver";
  }
  const existing = await db
    .select({ id: driverTariff.id })
    .from(driverTariff)
    .where(eq(driverTariff.driverId, author.id))
    .limit(1);
  if (existing[0]) {
    await db
      .update(driverTariff)
      .set({
        flagCents: tariff.flagCents,
        perMileCents: tariff.perMileCents,
        perWaitMinuteCents: tariff.perWaitMinuteCents,
      })
      .where(eq(driverTariff.driverId, author.id));
  } else {
    await db.insert(driverTariff).values({
      driverId: author.id,
      flagCents: tariff.flagCents,
      perMileCents: tariff.perMileCents,
      perWaitMinuteCents: tariff.perWaitMinuteCents,
    });
  }
  return tariff;
}
