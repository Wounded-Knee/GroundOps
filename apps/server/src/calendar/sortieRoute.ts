import type { DrivingRoute, GeoCoordinate, SortieStop, User } from "@groundops/contracts";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db.js";
import { findDriver } from "../identity/driver.js";
import { sortie, sortieStop } from "../schema.js";

export type SortieRouteDeps = {
  computeDrivingRoute: (
    origin: GeoCoordinate,
    destination: GeoCoordinate,
    intermediates: GeoCoordinate[],
  ) => Promise<DrivingRoute | "no-route" | "failed">;
};

/** Driving route from the device through the remaining stops of an authored sortie. */
export async function computeSortieDrivingRoute(
  person: User,
  sortieId: string,
  origin: GeoCoordinate,
  firstStopPosition: number,
  deps: SortieRouteDeps,
): Promise<DrivingRoute | "no-driver" | "not-found" | "invalid" | "no-route" | "failed"> {
  if (!Number.isInteger(firstStopPosition) || firstStopPosition < 0) {
    return "invalid";
  }
  const author = await findDriver(db, person.id);
  if (!author) {
    return "no-driver";
  }
  const rows = await db
    .select({ id: sortie.id })
    .from(sortie)
    .where(and(eq(sortie.id, sortieId), eq(sortie.authorDriverId, author.id)))
    .limit(1);
  if (!rows[0]) {
    return "not-found";
  }
  const stops = await db
    .select({
      position: sortieStop.position,
      label: sortieStop.label,
      latitude: sortieStop.latitude,
      longitude: sortieStop.longitude,
    })
    .from(sortieStop)
    .where(eq(sortieStop.sortieId, sortieId))
    .orderBy(asc(sortieStop.position));
  if (stops.length === 0) {
    return "invalid";
  }
  const remaining = stops.filter((stop) => stop.position >= firstStopPosition);
  if (remaining.length === 0 || remaining[0]?.position !== firstStopPosition) {
    return "invalid";
  }
  const last = remaining[remaining.length - 1];
  if (!last) {
    return "invalid";
  }
  const destination: GeoCoordinate = { latitude: last.latitude, longitude: last.longitude };
  const intermediates: GeoCoordinate[] = remaining.slice(0, -1).map((stop) => ({
    latitude: stop.latitude,
    longitude: stop.longitude,
  }));
  return deps.computeDrivingRoute(origin, destination, intermediates);
}

export function remainingStopsFrom(
  stops: SortieStop[],
  firstStopPosition: number,
): SortieStop[] {
  return stops.slice(firstStopPosition);
}
