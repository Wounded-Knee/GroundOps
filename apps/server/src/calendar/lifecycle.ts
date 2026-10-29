import type { Sortie, User } from "@groundops/contracts";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db.js";
import { findDriver } from "../identity/driver.js";
import { sortie, sortieStop } from "../schema.js";
import { clearDriverMeter } from "./meterReading.js";
import { alignFollowingSorties } from "./observations.js";
import { computeWindow } from "./schedule.js";
import {
  defaultScheduleDeps,
  departurePosition,
  presentSortie,
  publishSortie,
  sortieCommenced,
  sortieCompleted,
  sortieSelect,
  sortieStopArrivalAsserted,
  sortieStopDepartureInferred,
  stopsBySortie,
  toSortie,
  type ScheduleDeps,
  writeEvent,
} from "./support.js";

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
    return presentSortie(author.id, toSortie(row, stops), deps);
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
  const shown = await presentSortie(author.id, asserted, deps);
  await publishSortie(person.id, shown);
  return shown;
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
  const origin = await departurePosition(author.id, sortieId, row.arrivalAuthored ? row.arrivalAt : null, deps.now());
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
  if (typeof revised !== "object") {
    return revised;
  }
  const shown = await presentSortie(author.id, revised, deps);
  await publishSortie(person.id, shown);
  await alignFollowingSorties(author.id, person.id, deps);
  return shown;
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
    return presentSortie(author.id, toSortie(row, stops), deps);
  }

  const now = deps.now();
  const position = await departurePosition(author.id, row.id, row.arrivalAuthored ? row.arrivalAt : null, now);
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
  if (typeof commenced !== "object") {
    return commenced;
  }
  const shown = await presentSortie(author.id, commenced, deps);
  await publishSortie(person.id, shown);
  await alignFollowingSorties(author.id, person.id, deps);
  return shown;
}
/** The target stop of a commenced, unfinished sortie carries a passenger. */
export async function passengerLegUnderway(
  person: User,
  sortieId: string,
  firstStopPosition: number,
): Promise<boolean> {
  const author = await findDriver(db, person.id);
  if (!author) {
    return false;
  }
  const rows = await db
    .select({ passenger: sortieStop.passenger })
    .from(sortieStop)
    .innerJoin(sortie, eq(sortieStop.sortieId, sortie.id))
    .where(
      and(
        eq(sortie.id, sortieId),
        eq(sortie.authorDriverId, author.id),
        isNotNull(sortie.actualStart),
        isNull(sortie.actualEnd),
        eq(sortieStop.position, firstStopPosition),
        eq(sortieStop.passenger, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
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
    return presentSortie(author.id, toSortie(row, stops), deps);
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
  if (typeof completed !== "object") {
    return completed;
  }
  const shown = await presentSortie(author.id, completed, deps);
  await publishSortie(person.id, shown);
  await clearDriverMeter(author.id, person.id);
  return shown;
}
