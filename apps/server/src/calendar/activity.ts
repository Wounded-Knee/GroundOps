import type { ActivityResponse, Sortie, User } from "@groundops/contracts";
import { and, asc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db.js";
import { findDriver } from "../identity/driver.js";
import { sortie } from "../schema.js";
import { readDriverMeter } from "./meterReading.js";
import {
  defaultScheduleDeps,
  latestFix,
  presentSortie,
  presentSorties,
  resolveInProgressSortie,
  sortieSelect,
  stopsBySortie,
  toSortie,
  type ScheduleDeps,
} from "./support.js";

export async function readCalendar(
  person: User,
  from: Date,
  to: Date,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<Sortie[] | "no-driver" | "invalid-range"> {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() >= to.getTime()) {
    return "invalid-range";
  }

  const author = await findDriver(db, person.id);
  if (!author) {
    return "no-driver";
  }

  const rows = await db
    .select(sortieSelect)
    .from(sortie)
    .where(
      and(
        eq(sortie.authorDriverId, author.id),
        or(
          and(isNotNull(sortie.actualStart), lt(sortie.actualStart, to)),
          and(isNull(sortie.actualStart), lt(sortie.scheduledStart, to)),
        ),
        or(
          and(isNotNull(sortie.actualEnd), gt(sortie.actualEnd, from)),
          and(isNull(sortie.actualEnd), gt(sortie.scheduledEnd, from)),
        ),
      ),
    )
    .orderBy(sql`coalesce(${sortie.actualStart}, ${sortie.scheduledStart})`, asc(sortie.id));

  const stops = await stopsBySortie(
    db,
    rows.map((row) => row.id),
  );
  return presentSorties(
    author.id,
    rows.map((row) => toSortie(row, stops.get(row.id) ?? [])),
    deps,
  );
}
export async function readActivity(
  person: User,
  deps: ScheduleDeps = defaultScheduleDeps,
): Promise<ActivityResponse> {
  const asOf = new Date().toISOString();
  const author = await findDriver(db, person.id);
  if (!author) {
    return { asOf, location: null, sortie: null, meter: null };
  }
  const location = await latestFix(author.id);
  const inProgress = await resolveInProgressSortie(author.id, null);
  const stops = inProgress ? ((await stopsBySortie(db, [inProgress.id])).get(inProgress.id) ?? []) : [];
  return {
    asOf,
    location,
    sortie: inProgress ? await presentSortie(author.id, toSortie(inProgress, stops), deps) : null,
    meter: await readDriverMeter(author.id),
  };
}
