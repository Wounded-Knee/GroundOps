import { eq } from "drizzle-orm";
import type { DriverDb } from "../identity/driver.js";
import {
  driverMeterReading,
  driverTariff,
  locationObservation,
  operationalEvent,
  sortie,
  sortieStop,
} from "../schema.js";

/** True when the driver has sorties, fixes, a meter, or a tariff. Those rows block user removal. */
export async function driverHasOperationalRecords(tx: DriverDb, driverId: string): Promise<boolean> {
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

/**
 * Deletes operational rows owned by one driver.
 * Meter and tariff reference sorties, and stops, events, and fixes do too, so those go first.
 */
export async function deleteOwnedByDriver(tx: DriverDb, driverId: string): Promise<void> {
  await tx.delete(driverMeterReading).where(eq(driverMeterReading.driverId, driverId));
  await tx.delete(driverTariff).where(eq(driverTariff.driverId, driverId));
  const sorties = await tx.select({ id: sortie.id }).from(sortie).where(eq(sortie.authorDriverId, driverId));
  for (const item of sorties) {
    await tx.delete(operationalEvent).where(eq(operationalEvent.sortieId, item.id));
    await tx.delete(sortieStop).where(eq(sortieStop.sortieId, item.id));
  }
  await tx.delete(locationObservation).where(eq(locationObservation.driverId, driverId));
  await tx.delete(sortie).where(eq(sortie.authorDriverId, driverId));
}
