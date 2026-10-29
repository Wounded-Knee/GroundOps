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

describe("sortie lifecycle", () => {
  it("seals actualStart on commence and preserves it on in-progress revise", async () => {
    const person = await createSession({
      sub: `calendar-commence-${crypto.randomUUID()}`,
      displayName: "Commence",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      const arrival = new Date("2026-09-02T15:00:00.000Z");
      const authored = await authorSortie(person.user, task("Seal", arrival), scheduleDeps);
      assert.equal(typeof authored, "object");
      if (typeof authored !== "object") {
        return;
      }
      assert.equal(authored.actualStart, null);

      const commenceNow = new Date("2026-09-02T14:20:00.000Z");
      const commenced = await commenceSortie(person.user, authored.id, {
        ...scheduleDeps,
        now: () => commenceNow,
      });
      assert.equal(typeof commenced, "object");
      if (typeof commenced !== "object") {
        return;
      }
      assert.equal(commenced.actualStart, commenceNow.toISOString());
      assert.equal(commenced.scheduledStart, authored.scheduledStart);

      const again = await commenceSortie(person.user, authored.id, {
        ...scheduleDeps,
        now: () => new Date("2026-09-02T14:25:00.000Z"),
      });
      assert.equal(typeof again, "object");
      if (typeof again !== "object") {
        return;
      }
      assert.equal(again.actualStart, commenceNow.toISOString());

      const revised = await reviseSortie(
        person.user,
        authored.id,
        task("Seal", arrival),
        scheduleDeps,
      );
      assert.equal(typeof revised, "object");
      if (typeof revised !== "object") {
        return;
      }
      assert.equal(revised.actualStart, commenceNow.toISOString());

      const events = await eventsFor(authored.id);
      assert.ok(events.some((event) => event.type === "sortie.commenced"));
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("asserts stop arrival and extends wait while in progress", async () => {
    const person = await createSession({
      sub: `calendar-dwell-${crypto.randomUUID()}`,
      displayName: "Dwell",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      const arrival = new Date("2026-09-02T15:00:00.000Z");
      const authored = await authorSortie(
        person.user,
        task("Dwell", arrival, {
          stops: [
            { ...originStop, waitMinutes: 5 },
            { ...destinationStop, waitMinutes: 0 },
          ],
        }),
        scheduleDeps,
      );
      assert.equal(typeof authored, "object");
      if (typeof authored !== "object") {
        return;
      }
      const endBefore = authored.scheduledEnd;

      const commenced = await commenceSortie(person.user, authored.id, {
        ...scheduleDeps,
        now: () => new Date("2026-09-02T14:20:00.000Z"),
      });
      assert.equal(typeof commenced, "object");
      if (typeof commenced !== "object") {
        return;
      }

      const arriveNow = new Date("2026-09-02T15:00:00.000Z");
      const arrived = await assertStopArrival(person.user, authored.id, 0, {
        ...scheduleDeps,
        now: () => arriveNow,
      });
      assert.equal(typeof arrived, "object");
      if (typeof arrived !== "object") {
        return;
      }
      assert.equal(arrived.stops[0]?.actualArrivedAt, arriveNow.toISOString());

      const again = await assertStopArrival(person.user, authored.id, 0, {
        ...scheduleDeps,
        now: () => new Date("2026-09-02T15:01:00.000Z"),
      });
      assert.equal(typeof again, "object");
      if (typeof again !== "object") {
        return;
      }
      assert.equal(again.stops[0]?.actualArrivedAt, arriveNow.toISOString());

      const extended = await extendStopWait(person.user, authored.id, 0, scheduleDeps);
      assert.equal(typeof extended, "object");
      if (typeof extended !== "object") {
        return;
      }
      assert.equal(extended.stops[0]?.waitMinutes, 6);
      assert.ok(new Date(extended.scheduledEnd).getTime() > new Date(endBefore).getTime());

      const events = await eventsFor(authored.id);
      assert.ok(events.some((event) => event.type === "sortie.stop_arrival_asserted"));
    } finally {
      await removeUser(person.user.id);
    }
  });

});
