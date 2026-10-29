import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { closeDatabase, db } from "../db.js";
import { migrateDatabase } from "../migrate.js";
import { createSession } from "../identity/sessions.js";
import {
  addressBookEntry,
  addressBookPhoneStar,
  company,
  driver,
  driverAvailabilityEvent,
  driverCompany,
  driverMeterReading,
  driverTariff,
  locationObservation,
  operationalEvent,
  session,
  sortie,
  sortieStop,
  user,
  userCredential,
} from "../schema.js";
import {
  assertStopArrival,
  authorSortie,
  commenceSortie,
  completeSortie,
  ensureDriver,
  extendStopWait,
  previewSortie,
  readCalendar,
  recordObservation,
  reviseSortie,
  type ScheduleDeps,
  type SortieInput,
} from "./calendar.js";
import { registerCalendarRoutes } from "./http.js";
import { computeWindow } from "./schedule.js";
import {
  companiesFor,
  destinationStop,
  driverCount,
  driverFix,
  eventsFor,
  hopMeters,
  lineDriveDuration,
  linePoints,
  lineStop,
  lineT,
  originStop,
  placeDriver,
  pointA,
  pointB,
  pointC,
  pointD,
  pointE,
  removeUser,
  scheduleDeps,
  scheduleNow,
  shownDeparture,
  task,
  taskJson,
  hopSeconds,
  northOf,
  waypointStop,
  type DriveCall,
} from "./calendarDb.js";

before(async () => {
  await migrateDatabase();
});

after(async () => {
  await closeDatabase();
});

describe("sortie calendar read", () => {
  it("includes completed sorties in calendar range via coalesced end", async () => {
    const person = await createSession({
      sub: `calendar-coalesce-end-${crypto.randomUUID()}`,
      displayName: "CoalesceEnd",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      const arrival = new Date("2026-09-02T15:00:00.000Z");
      const authored = await authorSortie(person.user, task("Short", arrival), {
        ...scheduleDeps,
        driveDuration: async () => 60,
      });
      assert.equal(typeof authored, "object");
      if (typeof authored !== "object") {
        return;
      }
      await commenceSortie(person.user, authored.id, {
        ...scheduleDeps,
        driveDuration: async () => 60,
        now: () => new Date("2026-09-02T14:50:00.000Z"),
      });
      const completed = await completeSortie(person.user, authored.id, {
        ...scheduleDeps,
        now: () => new Date("2026-09-02T14:55:00.000Z"),
      });
      assert.equal(typeof completed, "object");
      if (typeof completed !== "object") {
        return;
      }

      const during = await readCalendar(
        person.user,
        new Date("2026-09-02T14:52:00.000Z"),
        new Date("2026-09-02T14:54:00.000Z"),
      );
      assert.ok(Array.isArray(during));
      if (!Array.isArray(during)) {
        return;
      }
      assert.ok(during.some((item) => item.id === authored.id));

      // After actualEnd but still before scheduledEnd — coalesced end must exclude it.
      assert.ok(new Date(completed.scheduledEnd).getTime() > new Date("2026-09-02T14:56:00.000Z").getTime());
      const afterActual = await readCalendar(
        person.user,
        new Date("2026-09-02T14:56:00.000Z"),
        new Date("2026-09-02T15:30:00.000Z"),
      );
      assert.ok(Array.isArray(afterActual));
      if (!Array.isArray(afterActual)) {
        return;
      }
      assert.equal(
        afterActual.some((item) => item.id === authored.id),
        false,
      );
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("returns only the caller's server-recorded availability, including a lapse", async () => {
    const person = await createSession({
      sub: `calendar-availability-${crypto.randomUUID()}`,
      displayName: "Available",
      email: null,
    });
    const other = await createSession({
      sub: `calendar-availability-other-${crypto.randomUUID()}`,
      displayName: "Other",
      email: null,
    });
    const app = Fastify();
    registerCalendarRoutes(app);
    try {
      const own = await ensureDriver(person.user);
      const theirs = await ensureDriver(other.user);
      const on = new Date("2026-10-11T14:00:00.000Z");
      const lapse = new Date("2026-10-11T15:00:00.000Z");
      const restored = new Date("2026-10-11T16:00:00.000Z");
      await db.insert(driverAvailabilityEvent).values([
        { driverId: own.id, available: true, current: true, recordedAt: on },
        { driverId: own.id, available: true, current: false, recordedAt: lapse },
        { driverId: own.id, available: true, current: true, recordedAt: restored },
        { driverId: theirs.id, available: true, current: true, recordedAt: on },
      ]);

      const day = await app.inject({
        method: "GET",
        url: "/calendar?from=2026-10-11T00:00:00.000Z&to=2026-10-12T00:00:00.000Z",
        headers: { authorization: `Bearer ${person.token}` },
      });
      assert.equal(day.statusCode, 200);
      assert.deepEqual(day.json().availability, [
        { start: on.toISOString(), end: lapse.toISOString() },
        { start: restored.toISOString(), end: null },
      ]);

      const clipped = await app.inject({
        method: "GET",
        url: "/calendar?from=2026-10-11T14:30:00.000Z&to=2026-10-11T15:30:00.000Z",
        headers: { authorization: `Bearer ${person.token}` },
      });
      assert.equal(clipped.statusCode, 200);
      assert.deepEqual(clipped.json().availability, [
        { start: "2026-10-11T14:30:00.000Z", end: lapse.toISOString() },
      ]);
    } finally {
      await app.close();
      await removeUser(person.user.id);
      await removeUser(other.user.id);
    }
  });
});
