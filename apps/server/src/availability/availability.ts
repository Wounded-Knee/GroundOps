import type { AvailabilityResponse, User } from "@groundops/contracts";
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { ensureDriver } from "../calendar/calendar.js";
import { db } from "../db.js";
import { availabilityUpdated, publishRealtime } from "../realtime.js";
import { driver, driverAvailabilityEvent } from "../schema.js";

/** A check-in this old is still treated as available. Older than this is a lapse. */
export const availabilityLeaseMs = 5 * 60 * 1000;

export const availabilityLapseIntervalMs = 60 * 1000;

type DriverAvailability = {
  id: string;
  userId: string;
  available: boolean;
  availabilityCheckedAt: Date | null;
};

let lapseChain: Promise<void> = Promise.resolve();

/** The platform treats the driver as available only when the choice is set and the check-in is fresh. */
export function isAvailabilityCurrent(available: boolean, checkedAt: Date | null, now: Date): boolean {
  if (!available || checkedAt === null) {
    return false;
  }
  return now.getTime() - checkedAt.getTime() <= availabilityLeaseMs;
}

/**
 * Records each stale check-in once. Does not change the driver's choice.
 * Calls share one chain so a second pass sees the first event.
 */
export function recordAvailabilityLapse(now: Date): Promise<void> {
  const run = lapseChain.then(() => lapseAvailability(now));
  lapseChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function readAvailability(person: User, now: Date): Promise<AvailabilityResponse> {
  const ensured = await ensureDriver(person);
  await recordAvailabilityLapse(now);
  return toResponse(await loadDriver(ensured.id), now);
}

/** Sets the driver's choice. The same choice writes nothing. */
export async function setAvailability(person: User, available: boolean, now: Date): Promise<AvailabilityResponse> {
  const ensured = await ensureDriver(person);
  await recordAvailabilityLapse(now);
  const written = await db.transaction(async (tx) => {
    const row = await lockDriver(tx, ensured.id);
    if (row.available === available) {
      return { response: toResponse(row, now), publish: null };
    }
    const checkedAt = available ? now : null;
    await tx
      .update(driver)
      .set({ available, availabilityCheckedAt: checkedAt })
      .where(eq(driver.id, row.id));
    await tx.insert(driverAvailabilityEvent).values({
      driverId: row.id,
      available,
      current: available,
      recordedAt: now,
    });
    return {
      response: { asOf: now.toISOString(), available, current: available },
      publish: { userId: row.userId, available, current: available, recordedAt: now.toISOString() },
    };
  });
  if (written.publish) {
    await publishRealtime(
      availabilityUpdated(written.publish.userId, written.publish.available, written.publish.current, written.publish.recordedAt),
    );
  }
  return written.response;
}

/**
 * Refreshes the check-in when the driver is already available, including after a lapse.
 * Does not turn an unwilling driver back on.
 */
export async function checkInAvailability(person: User, now: Date): Promise<AvailabilityResponse> {
  const ensured = await ensureDriver(person);
  const existing = await loadDriver(ensured.id);
  if (!existing.available) {
    return { asOf: now.toISOString(), available: false, current: false };
  }
  const wasCurrent = isAvailabilityCurrent(true, existing.availabilityCheckedAt, now);
  if (!wasCurrent) {
    await recordAvailabilityLapse(now);
  }
  const written = await db.transaction(async (tx) => {
    const row = await lockDriver(tx, ensured.id);
    if (!row.available) {
      return { response: { asOf: now.toISOString(), available: false, current: false }, publish: null };
    }
    const stillCurrent = isAvailabilityCurrent(true, row.availabilityCheckedAt, now);
    await tx.update(driver).set({ availabilityCheckedAt: now }).where(eq(driver.id, row.id));
    if (stillCurrent) {
      return { response: { asOf: now.toISOString(), available: true, current: true }, publish: null };
    }
    const recordedAt = new Date(now.getTime() + 1);
    await tx.insert(driverAvailabilityEvent).values({
      driverId: row.id,
      available: true,
      current: true,
      recordedAt,
    });
    return {
      response: { asOf: now.toISOString(), available: true, current: true },
      publish: { userId: row.userId, recordedAt: recordedAt.toISOString() },
    };
  });
  if (written.publish) {
    await publishRealtime(availabilityUpdated(written.publish.userId, true, true, written.publish.recordedAt));
  }
  return written.response;
}

/** Starts the in-process sweep. Importing this module does not start it. */
export function startAvailabilityLapseInterval(onError: (error: unknown) => void): () => void {
  const timer = setInterval(() => {
    void recordAvailabilityLapse(new Date()).catch(onError);
  }, availabilityLapseIntervalMs);
  return () => {
    clearInterval(timer);
  };
}

async function lapseAvailability(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - availabilityLeaseMs);
  const stale = await db
    .select({ id: driver.id })
    .from(driver)
    .where(and(eq(driver.available, true), isNotNull(driver.availabilityCheckedAt), lt(driver.availabilityCheckedAt, cutoff)));
  for (const row of stale) {
    const userId = await db.transaction(async (tx) => {
      const locked = await lockDriver(tx, row.id);
      if (!locked.available || locked.availabilityCheckedAt === null || locked.availabilityCheckedAt.getTime() >= cutoff.getTime()) {
        return null;
      }
      const latest = await tx
        .select({
          available: driverAvailabilityEvent.available,
          current: driverAvailabilityEvent.current,
        })
        .from(driverAvailabilityEvent)
        .where(eq(driverAvailabilityEvent.driverId, row.id))
        .orderBy(desc(driverAvailabilityEvent.recordedAt), desc(driverAvailabilityEvent.id))
        .limit(1);
      if (latest[0]?.available === true && latest[0]?.current === false) {
        return null;
      }
      await tx.insert(driverAvailabilityEvent).values({
        driverId: row.id,
        available: true,
        current: false,
        recordedAt: now,
      });
      return locked.userId;
    });
    if (userId) {
      await publishRealtime(availabilityUpdated(userId, true, false, now.toISOString()));
    }
  }
}

function toResponse(row: DriverAvailability, now: Date): AvailabilityResponse {
  return {
    asOf: now.toISOString(),
    available: row.available,
    current: isAvailabilityCurrent(row.available, row.availabilityCheckedAt, now),
  };
}

async function loadDriver(driverId: string): Promise<DriverAvailability> {
  const rows = await db
    .select({
      id: driver.id,
      userId: driver.userId,
      available: driver.available,
      availabilityCheckedAt: driver.availabilityCheckedAt,
    })
    .from(driver)
    .where(eq(driver.id, driverId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("driver missing");
  }
  return row;
}

async function lockDriver(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  driverId: string,
): Promise<DriverAvailability> {
  const rows = await tx
    .select({
      id: driver.id,
      userId: driver.userId,
      available: driver.available,
      availabilityCheckedAt: driver.availabilityCheckedAt,
    })
    .from(driver)
    .where(eq(driver.id, driverId))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("driver missing");
  }
  return row;
}
