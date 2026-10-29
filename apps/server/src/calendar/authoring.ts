import { taskSortieType, type Sortie, type SortiePreviewResponse, type User } from "@groundops/contracts";
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import { findCompanyId, findDriver } from "../identity/driver.js";
import { sortie, sortieStop } from "../schema.js";
import { alignFollowingSorties } from "./observations.js";
import { approachOrigin, computeWindow, scheduleBackoffMs, type ApproachOrigin, type SortiePlace } from "./schedule.js";
import {
  anchorOf,
  defaultScheduleDeps,
  departurePosition,
  driverPlaces,
  latestObservation,
  mergeStopActuals,
  openSorties,
  presentSortie,
  previewPlaceId,
  publishSortie,
  samePlace,
  sortieCreated,
  sortieRevised,
  sortieSelect,
  stopsBySortie,
  toSortie,
  type HeldWindow,
  type ScheduleDeps,
  type SortieInput,
  validSortie,
  warningLabel,
  windowsOverlap,
  writeEvent,
  writeStops,
} from "./support.js";

export async function authorSortie(
  person: User,
  input: SortieInput,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<Sortie | "no-driver" | "invalid" | "no-location" | "unavailable"> {
  const valid = validSortie(input);
  if (!valid) {
    return "invalid";
  }

  const author = await findDriver(db, person.id);
  if (!author) {
    return "no-driver";
  }
  const companyId = await findCompanyId(db, author.id);
  if (!companyId) {
    return "no-driver";
  }
  const position = await departurePosition(author.id, null, valid.arrivalAt, deps.now());
  if (!position) {
    return "no-location";
  }
  const window = await computeWindow(position, valid.stops, valid.arrivalAt, deps.now(), deps.driveDuration);
  if (window === "failed") {
    return "unavailable";
  }

  const authored = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(sortie)
      .values({
        companyId,
        authorDriverId: author.id,
        type: taskSortieType,
        label: valid.label,
        arrivalAt: window.arrivalAt,
        arrivalAuthored: valid.arrivalAt !== null,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        scheduleOriginLatitude: position.latitude,
        scheduleOriginLongitude: position.longitude,
        scheduleFailedAt: null,
        passengerName: valid.passengerName,
        passengerPhone: valid.passengerPhone,
      })
      .returning(sortieSelect);
    const row = inserted[0];
    if (!row) {
      throw new Error("sortie insert returned no row");
    }

    await writeStops(tx, row.id, valid.stops);
    await writeEvent(tx, sortieCreated, row, valid.stops);
    return toSortie(row, valid.stops);
  });
  if (typeof authored !== "object") {
    return authored;
  }
  const shown = await presentSortie(author.id, authored, deps);
  await publishSortie(person.id, shown);
  await alignFollowingSorties(author.id, person.id, deps);
  return shown;
}
export async function previewSortie(
  person: User,
  input: SortieInput,
  sortieId: string | null,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<SortiePreviewResponse | "invalid" | "no-driver" | "no-location"> {
  const valid = validSortie(input);
  if (!valid) {
    return "invalid";
  }
  const author = await findDriver(db, person.id);
  if (!author) {
    return "no-driver";
  }

  const now = deps.now();
  const gps = await latestObservation(db, author.id);
  const places = await driverPlaces(author.id);
  const position: ApproachOrigin | null =
    valid.arrivalAt === null
      ? gps
        ? { ...gps, label: null }
        : null
      : approachOrigin(places, valid.arrivalAt, sortieId, gps, now);
  if (!position) {
    return "no-location";
  }

  const draftWindow = await computeWindow(position, valid.stops, valid.arrivalAt, now, deps.driveDuration);
  if (draftWindow === "failed") {
    return { endangered: [] };
  }

  const lastStop = valid.stops[valid.stops.length - 1];
  if (!lastStop) {
    return { endangered: [] };
  }
  const draftPlace: SortiePlace = {
    id: sortieId ?? previewPlaceId,
    arrivalAt: draftWindow.arrivalAt,
    scheduledEnd: draftWindow.scheduledEnd,
    actualStart: null,
    actualEnd: null,
    destination: { latitude: lastStop.latitude, longitude: lastStop.longitude },
    destinationLabel: lastStop.label,
  };
  const hypothetical = places.filter((place) => place.id !== draftPlace.id);
  hypothetical.push(draftPlace);

  const rows = (await openSorties(author.id, now)).filter((row) => row.id !== sortieId);
  const stopLists = await stopsBySortie(
    db,
    rows.map((row) => row.id),
  );
  const held: HeldWindow[] = [];
  for (const row of rows) {
    const stops = stopLists.get(row.id) ?? [];
    const cachedStart = row.scheduledStart;
    const cachedEnd = row.scheduledEnd;
    const base = {
      id: row.id,
      label: warningLabel(row.label, stops),
      cachedStart,
      cachedEnd,
    };
    if (row.actualEnd !== null) {
      continue;
    }
    if (row.actualStart !== null) {
      held.push({ ...base, start: cachedStart, end: cachedEnd, changed: false, failed: false });
      continue;
    }
    const origin = approachOrigin(hypothetical, row.arrivalAt, row.id, gps, now);
    const anchor = origin ? anchorOf(row) : null;
    const withinBackoff =
      row.scheduleFailedAt !== null && now.getTime() - row.scheduleFailedAt.getTime() < scheduleBackoffMs;
    if (
      !origin ||
      (anchor && samePlace(anchor, origin)) ||
      withinBackoff ||
      (origin.label !== null && !row.arrivalAuthored)
    ) {
      held.push({ ...base, start: cachedStart, end: cachedEnd, changed: false, failed: false });
      continue;
    }
    const window = await computeWindow(
      origin,
      stops,
      row.arrivalAuthored ? row.arrivalAt : null,
      now,
      deps.driveDuration,
    );
    if (window === "failed") {
      held.push({ ...base, start: cachedStart, end: cachedEnd, changed: true, failed: true });
      continue;
    }
    held.push({
      ...base,
      start: window.scheduledStart,
      end: window.scheduledEnd,
      changed:
        window.scheduledStart.getTime() !== cachedStart.getTime() ||
        window.scheduledEnd.getTime() !== cachedEnd.getTime(),
      failed: false,
    });
  }

  const endangered = new Set<string>();
  for (const item of held) {
    if (item.failed || windowsOverlap(item.start, item.end, draftWindow.scheduledStart, draftWindow.scheduledEnd)) {
      endangered.add(item.id);
    }
  }
  for (let leftIndex = 0; leftIndex < held.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < held.length; rightIndex += 1) {
      const left = held[leftIndex];
      const right = held[rightIndex];
      if (!left || !right || left.failed || right.failed || (!left.changed && !right.changed)) {
        continue;
      }
      const overlappedBefore = windowsOverlap(left.cachedStart, left.cachedEnd, right.cachedStart, right.cachedEnd);
      if (!overlappedBefore && windowsOverlap(left.start, left.end, right.start, right.end)) {
        endangered.add(left.id);
        endangered.add(right.id);
      }
    }
  }

  return {
    endangered: held
      .filter((item) => endangered.has(item.id))
      .sort((left, right) => left.start.getTime() - right.start.getTime() || left.id.localeCompare(right.id))
      .map((item) => ({ id: item.id, label: item.label })),
  };
}
export async function reviseSortie(
  person: User,
  sortieId: string,
  input: SortieInput,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<Sortie | "invalid" | "not-found" | "no-location" | "unavailable"> {
  const valid = validSortie(input);
  if (!valid) {
    return "invalid";
  }

  const author = await findDriver(db, person.id);
  if (!author) {
    return "not-found";
  }
  const existingRows = await db
    .select(sortieSelect)
    .from(sortie)
    .where(and(eq(sortie.id, sortieId), eq(sortie.authorDriverId, author.id)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    return "not-found";
  }
  const previousStops = (await stopsBySortie(db, [sortieId])).get(sortieId) ?? [];
  const inProgress = existing.actualStart !== null && existing.actualEnd === null;
  const nextStops = mergeStopActuals(valid.stops, previousStops, inProgress);

  const position = await departurePosition(author.id, sortieId, valid.arrivalAt, deps.now());
  if (!position) {
    return "no-location";
  }
  const window = await computeWindow(position, nextStops, valid.arrivalAt, deps.now(), deps.driveDuration);
  if (window === "failed") {
    return "unavailable";
  }

  const revised = await db.transaction(async (tx) => {
    const updated = await tx
      .update(sortie)
      .set({
        label: valid.label,
        arrivalAt: window.arrivalAt,
        arrivalAuthored: valid.arrivalAt !== null,
        scheduledStart: inProgress ? existing.scheduledStart : window.scheduledStart,
        scheduledEnd: window.scheduledEnd,
        actualStart: inProgress ? existing.actualStart : null,
        actualEnd: inProgress ? existing.actualEnd : null,
        scheduleOriginLatitude: position.latitude,
        scheduleOriginLongitude: position.longitude,
        scheduleFailedAt: null,
        passengerName: valid.passengerName,
        passengerPhone: valid.passengerPhone,
      })
      .where(eq(sortie.id, sortieId))
      .returning(sortieSelect);
    const row = updated[0];
    if (!row) {
      return "not-found";
    }

    await tx.delete(sortieStop).where(eq(sortieStop.sortieId, sortieId));
    await writeStops(tx, row.id, nextStops);
    await writeEvent(tx, sortieRevised, row, nextStops);
    return toSortie(row, nextStops);
  });
  if (typeof revised !== "object") {
    return revised;
  }
  const shown = await presentSortie(author.id, revised, deps);
  await publishSortie(person.id, shown);
  await alignFollowingSorties(author.id, person.id, deps);
  return shown;
}
