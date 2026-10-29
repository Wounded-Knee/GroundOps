import type { GeoCoordinate, SortieStop, User } from "@groundops/contracts";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db.js";
import { findDriver } from "../identity/driver.js";
import { locationUpdated, publishRealtime } from "../realtime.js";
import { locationObservation, sortie, sortieStop } from "../schema.js";
import {
  anchorAwayFromCompletedTerminal,
  anchorAwayFromPickup,
  approachOrigin,
  computeWindow,
  distanceMeters,
  movedFarEnough,
  scheduleBackoffMs,
  type ApproachOrigin,
} from "./schedule.js";
import {
  anchorMatchesEndedPlace,
  anchorOf,
  defaultScheduleDeps,
  driverPlaces,
  latestObservation,
  openSorties,
  pickupCoordinates,
  presentSortie,
  publishSortie,
  resolveInProgressSortie,
  samePlace,
  sortieScheduleComputed,
  sortieStopArrivalInferred,
  sortieStopDepartureInferred,
  stopsBySortie,
  stopArrivalMeters,
  toSortie,
  type ObservationInput,
  type OpenSortie,
  type ScheduleDeps,
  type SortieRow,
  type StoredSortie,
  validObservation,
  writeEvent,
} from "./support.js";

export async function recordObservation(
  person: User,
  input: ObservationInput,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<"ok" | "no-driver" | "invalid"> {
  if (!validObservation(input)) {
    return "invalid";
  }
  const author = await findDriver(db, person.id);
  if (!author) {
    return "no-driver";
  }

  const inProgress = await resolveInProgressSortie(author.id, input.sortieId ?? null);
  await db.insert(locationObservation).values({
    driverId: author.id,
    sortieId: inProgress?.id ?? null,
    observedAt: input.observedAt,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
  });
  await publishRealtime(
    locationUpdated(person.id, {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      observedAt: input.observedAt.toISOString(),
    }),
  );
  if (inProgress) {
    await inferStopActuals(person.id, author.id, inProgress, {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      observedAt: input.observedAt,
    }, deps);
  }
  await recomputeOpenSorties(author.id, person.id, { latitude: input.latitude, longitude: input.longitude }, deps);
  return "ok";
}
async function recomputeOpenSorties(
  driverId: string,
  userId: string,
  position: GeoCoordinate,
  deps: ScheduleDeps,
): Promise<void> {
  const now = deps.now();
  const rows = await openSorties(driverId, now);

  const places = await driverPlaces(driverId);
  const pickups = await pickupCoordinates(rows.map((row) => row.id));
  for (const row of rows) {
    if (row.actualStart !== null) {
      continue;
    }
    if (approachOrigin(places, row.arrivalAt, row.id, null, now) !== null) {
      continue;
    }
    const anchor = anchorOf(row);
    const endedPlace = anchor !== null && anchorMatchesEndedPlace(places, anchor, now);
    const strayAnchor = anchor !== null && anchorAwayFromCompletedTerminal(places, anchor, position);
    const pickup = pickups.get(row.id) ?? null;
    const atPickup = anchor !== null && pickup !== null && anchorAwayFromPickup(anchor, position, pickup);
    await recomputeFrom(driverId, userId, row, { ...position, label: null }, now, deps, !(endedPlace || strayAnchor || atPickup));
  }
}
export async function alignFollowingSorties(driverId: string, userId: string, deps: ScheduleDeps): Promise<void> {
  const now = deps.now();
  const gps = await latestObservation(db, driverId);
  const places = await driverPlaces(driverId);
  const rows = await openSorties(driverId, now);
  for (const row of rows) {
    if (row.actualStart !== null) {
      continue;
    }
    const origin = approachOrigin(places, row.arrivalAt, row.id, gps, now);
    if (!origin) {
      continue;
    }
    await recomputeFrom(driverId, userId, row, origin, now, deps, false);
  }
}
async function recomputeFrom(
  driverId: string,
  userId: string,
  row: OpenSortie,
  position: ApproachOrigin,
  now: Date,
  deps: ScheduleDeps,
  requireMovement: boolean,
): Promise<void> {
  const anchor = anchorOf(row);
  if (requireMovement) {
    if (anchor && !movedFarEnough(anchor, position)) {
      return;
    }
  } else if (anchor && samePlace(anchor, position)) {
    return;
  }
  if (row.scheduleFailedAt && now.getTime() - row.scheduleFailedAt.getTime() < scheduleBackoffMs) {
    return;
  }

  if (!row.arrivalAuthored && position.label !== null) {
    return;
  }

  const stops = (await stopsBySortie(db, [row.id])).get(row.id) ?? [];
  const window = await computeWindow(
    position,
    stops,
    row.arrivalAuthored ? row.arrivalAt : null,
    now,
    deps.driveDuration,
  );
  if (window === "failed") {
    await db.update(sortie).set({ scheduleFailedAt: now }).where(eq(sortie.id, row.id));
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(sortie)
      .set({
        arrivalAt: window.arrivalAt,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        scheduleOriginLatitude: position.latitude,
        scheduleOriginLongitude: position.longitude,
        scheduleFailedAt: null,
      })
      .where(eq(sortie.id, row.id));
    await writeEvent(
      tx,
      sortieScheduleComputed,
      {
        id: row.id,
        label: row.label,
        arrivalAt: window.arrivalAt,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        passengerName: row.passengerName,
        passengerPhone: row.passengerPhone,
      },
      stops,
    );
  });
  await publishSortie(
    userId,
    await presentSortie(
      driverId,
      toSortie(
        {
          ...row,
          arrivalAt: window.arrivalAt,
          scheduledStart: window.scheduledStart,
          scheduledEnd: window.scheduledEnd,
        },
        stops,
      ),
      deps,
    ),
  );
}
async function inferStopActuals(
  userId: string,
  driverId: string,
  inProgress: StoredSortie,
  fix: { latitude: number; longitude: number; accuracyMeters: number | null; observedAt: Date },
  deps: ScheduleDeps,
): Promise<void> {
  const stopRows = await db
    .select({
      position: sortieStop.position,
      label: sortieStop.label,
      latitude: sortieStop.latitude,
      longitude: sortieStop.longitude,
      waitMinutes: sortieStop.waitMinutes,
      passenger: sortieStop.passenger,
      actualArrivedAt: sortieStop.actualArrivedAt,
      actualDepartedAt: sortieStop.actualDepartedAt,
    })
    .from(sortieStop)
    .where(eq(sortieStop.sortieId, inProgress.id))
    .orderBy(asc(sortieStop.position));
  if (stopRows.length === 0) {
    return;
  }

  const threshold = geofenceMeters(fix.accuracyMeters);
  const stops: SortieStop[] = stopRows.map((row) => ({
    label: row.label,
    latitude: row.latitude,
    longitude: row.longitude,
    waitMinutes: row.waitMinutes,
    passenger: row.passenger,
    actualArrivedAt: row.actualArrivedAt ? row.actualArrivedAt.toISOString() : null,
    actualDepartedAt: row.actualDepartedAt ? row.actualDepartedAt.toISOString() : null,
  }));

  for (let index = 0; index < stopRows.length; index += 1) {
    const row = stopRows[index]!;
    const place = { latitude: row.latitude, longitude: row.longitude };
    const meters = distanceMeters(fix, place);

    if (row.actualArrivedAt === null) {
      if (meters <= threshold) {
        const nextStops = stops.map((stop, stopIndex) =>
          stopIndex === index ? { ...stop, actualArrivedAt: fix.observedAt.toISOString() } : stop,
        );
        await db.transaction(async (tx) => {
          await tx
            .update(sortieStop)
            .set({ actualArrivedAt: fix.observedAt })
            .where(and(eq(sortieStop.sortieId, inProgress.id), eq(sortieStop.position, index)));
          await writeEvent(tx, sortieStopArrivalInferred, inProgress, nextStops);
        });
        await publishSortie(userId, await presentSortie(driverId, toSortie(inProgress, nextStops), deps));
      }
      return;
    }

    if (row.actualDepartedAt === null) {
      if (meters > threshold) {
        const nextStops = stops.map((stop, stopIndex) =>
          stopIndex === index ? { ...stop, actualDepartedAt: fix.observedAt.toISOString() } : stop,
        );
        await db.transaction(async (tx) => {
          await tx
            .update(sortieStop)
            .set({ actualDepartedAt: fix.observedAt })
            .where(and(eq(sortieStop.sortieId, inProgress.id), eq(sortieStop.position, index)));
          await writeEvent(tx, sortieStopDepartureInferred, inProgress, nextStops);
        });
        await publishSortie(userId, await presentSortie(driverId, toSortie(inProgress, nextStops), deps));
      }
      return;
    }
  }
}

function geofenceMeters(accuracyMeters: number | null): number {
  if (accuracyMeters === null || !Number.isFinite(accuracyMeters)) {
    return stopArrivalMeters;
  }
  return Math.max(stopArrivalMeters, accuracyMeters);
}
