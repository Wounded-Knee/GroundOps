import type { GeoCoordinate, MeterReading, ReplaceMeterReadingRequest, User } from "@groundops/contracts";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db.js";
import { meterCleared, meterUpdated, publishRealtime } from "../realtime.js";
import { driver, driverMeterReading, sortie } from "../schema.js";

export type MeterReadingInput = ReplaceMeterReadingRequest;

const maxPathPoints = 8000;

export async function replaceMeterReading(
  person: User,
  input: MeterReadingInput,
): Promise<MeterReading | "no-driver" | "not-in-progress" | "invalid"> {
  if (!validReading(input)) {
    return "invalid";
  }
  const author = await findDriver(person.id);
  if (!author) {
    return "no-driver";
  }
  const inProgress = await db
    .select({ id: sortie.id })
    .from(sortie)
    .where(
      and(
        eq(sortie.id, input.sortieId),
        eq(sortie.authorDriverId, author.id),
        isNotNull(sortie.actualStart),
        isNull(sortie.actualEnd),
      ),
    )
    .limit(1);
  if (!inProgress[0]) {
    return "not-in-progress";
  }

  const now = new Date();
  const path = input.overviewPath;
  const saved = await db
    .insert(driverMeterReading)
    .values({
      driverId: author.id,
      sortieId: input.sortieId,
      milesTraveled: input.milesTraveled,
      waitSeconds: input.waitSeconds,
      totalCents: input.totalCents,
      estimateCents: input.estimateCents,
      remainingMeters: input.remainingMeters,
      overviewPath: path ?? [],
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: driverMeterReading.driverId,
      set: {
        sortieId: input.sortieId,
        milesTraveled: input.milesTraveled,
        waitSeconds: input.waitSeconds,
        totalCents: input.totalCents,
        estimateCents: input.estimateCents,
        remainingMeters: input.remainingMeters,
        updatedAt: now,
        ...(path !== undefined ? { overviewPath: path } : {}),
      },
    })
    .returning({
      sortieId: driverMeterReading.sortieId,
      milesTraveled: driverMeterReading.milesTraveled,
      waitSeconds: driverMeterReading.waitSeconds,
      totalCents: driverMeterReading.totalCents,
      estimateCents: driverMeterReading.estimateCents,
      remainingMeters: driverMeterReading.remainingMeters,
      overviewPath: driverMeterReading.overviewPath,
      updatedAt: driverMeterReading.updatedAt,
    });
  const row = saved[0];
  if (!row) {
    throw new Error("meter reading upsert returned no row");
  }
  const meter = toMeter(row);
  await publishRealtime(meterUpdated(person.id, meter, meter.updatedAt));
  return meter;
}

/** Deletes the driver's reading and tells every session the meter is clear. */
export async function clearDriverMeter(driverId: string, userId: string): Promise<void> {
  await db.delete(driverMeterReading).where(eq(driverMeterReading.driverId, driverId));
  await publishRealtime(meterCleared(userId));
}

export async function clearMeterReading(person: User): Promise<"ok" | "no-driver"> {
  const author = await findDriver(person.id);
  if (!author) {
    return "no-driver";
  }
  await clearDriverMeter(author.id, person.id);
  return "ok";
}

export async function readDriverMeter(driverId: string): Promise<MeterReading | null> {
  const rows = await db
    .select({
      sortieId: driverMeterReading.sortieId,
      milesTraveled: driverMeterReading.milesTraveled,
      waitSeconds: driverMeterReading.waitSeconds,
      totalCents: driverMeterReading.totalCents,
      estimateCents: driverMeterReading.estimateCents,
      remainingMeters: driverMeterReading.remainingMeters,
      overviewPath: driverMeterReading.overviewPath,
      updatedAt: driverMeterReading.updatedAt,
    })
    .from(driverMeterReading)
    .where(eq(driverMeterReading.driverId, driverId))
    .limit(1);
  const row = rows[0];
  return row ? toMeter(row) : null;
}

function toMeter(row: {
  sortieId: string;
  milesTraveled: number;
  waitSeconds: number;
  totalCents: number;
  estimateCents: number;
  remainingMeters: number;
  overviewPath: GeoCoordinate[];
  updatedAt: Date;
}): MeterReading {
  return {
    sortieId: row.sortieId,
    milesTraveled: row.milesTraveled,
    waitSeconds: row.waitSeconds,
    totalCents: row.totalCents,
    estimateCents: row.estimateCents,
    remainingMeters: row.remainingMeters,
    overviewPath: row.overviewPath,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findDriver(userId: string): Promise<{ id: string } | null> {
  const rows = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId)).limit(1);
  return rows[0] ?? null;
}

function validReading(input: MeterReadingInput): boolean {
  if (!Number.isFinite(input.milesTraveled) || input.milesTraveled < 0) {
    return false;
  }
  if (!Number.isFinite(input.waitSeconds) || input.waitSeconds < 0) {
    return false;
  }
  if (!Number.isInteger(input.totalCents) || input.totalCents < 0) {
    return false;
  }
  if (!Number.isInteger(input.estimateCents) || input.estimateCents < 0) {
    return false;
  }
  if (!Number.isFinite(input.remainingMeters) || input.remainingMeters < 0) {
    return false;
  }
  if (input.overviewPath !== undefined && !validPath(input.overviewPath)) {
    return false;
  }
  return true;
}

function validPath(path: GeoCoordinate[]): boolean {
  if (path.length > maxPathPoints) {
    return false;
  }
  return path.every(
    (point) =>
      Number.isFinite(point.latitude) &&
      point.latitude >= -90 &&
      point.latitude <= 90 &&
      Number.isFinite(point.longitude) &&
      point.longitude >= -180 &&
      point.longitude <= 180,
  );
}
