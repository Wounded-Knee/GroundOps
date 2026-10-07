import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { closeDatabase, db } from "../db.js";
import { migrateDatabase } from "../migrate.js";
import { createSession } from "../identity/sessions.js";
import {
  company,
  driver,
  driverCompany,
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
  readCalendar,
  recordObservation,
  reviseSortie,
  type ScheduleDeps,
  type SortieInput,
} from "./calendar.js";
import { registerCalendarRoutes } from "./http.js";
import { computeWindow } from "./schedule.js";

before(async () => {
  await migrateDatabase();
});

after(async () => {
  await closeDatabase();
});

describe("calendar", () => {
  it("creates one driver and company, then reuses them", async () => {
    const person = await createSession({
      sub: `calendar-${crypto.randomUUID()}`,
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });

    try {
      const first = await ensureDriver(person.user);
      const second = await ensureDriver(person.user);
      assert.equal(second.id, first.id);
      assert.equal(second.userId, person.user.id);

      const companies = await companiesFor(person.user.id);
      assert.deepEqual(companies, ["Ada Lovelace"]);
      assert.equal(await driverCount(person.user.id), 1);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("names the company from the email, then from the fallback", async () => {
    const byEmail = await createSession({
      sub: `calendar-email-${crypto.randomUUID()}`,
      displayName: "  ",
      email: "pilot@example.com",
    });
    const byFallback = await createSession({
      sub: `calendar-fallback-${crypto.randomUUID()}`,
      displayName: null,
      email: null,
    });

    try {
      await ensureDriver(byEmail.user);
      await ensureDriver(byFallback.user);
      assert.deepEqual(await companiesFor(byEmail.user.id), ["pilot@example.com"]);
      assert.deepEqual(await companiesFor(byFallback.user.id), ["Company"]);
    } finally {
      await removeUser(byEmail.user.id);
      await removeUser(byFallback.user.id);
    }
  });

  it("keeps each driver's authored sorties on their own calendar", async () => {
    const first = await createSession({
      sub: `calendar-a-${crypto.randomUUID()}`,
      displayName: "First",
      email: "first@example.com",
    });
    const second = await createSession({
      sub: `calendar-b-${crypto.randomUUID()}`,
      displayName: "Second",
      email: "second@example.com",
    });

    try {
      await ensureDriver(first.user);
      await placeDriver(first.user.id);
      await ensureDriver(second.user);
      assert.notEqual((await ensureDriver(second.user)).id, (await ensureDriver(first.user)).id);

      const from = new Date("2026-09-01T00:00:00.000Z");
      const to = new Date("2026-10-01T00:00:00.000Z");
      const authored = await authorSortie(
        first.user,
        task("  Crew move  ", new Date("2026-09-02T15:00:00.000Z")),
        scheduleDeps,
      );
      assert.equal(typeof authored, "object");
      if (typeof authored !== "object") {
        return;
      }
      assert.equal(authored.type, "task");
      assert.equal(authored.label, "Crew move");
      assert.equal(authored.arrivalAt, "2026-09-02T15:00:00.000Z");
      assert.equal(authored.scheduledStart, "2026-09-02T15:00:00.000Z");
      assert.equal(authored.scheduledEnd, "2026-09-02T16:00:00.000Z");
      assert.equal(authored.departureAddress, "Driver location");

      const earlier = await authorSortie(
        first.user,
        task("Earlier", new Date("2026-09-02T13:00:00.000Z")),
        scheduleDeps,
      );
      assert.equal(earlier !== "no-driver" && earlier !== "invalid", true);

      const outside = await authorSortie(
        first.user,
        task("Outside", new Date("2026-10-01T00:00:00.000Z")),
        scheduleDeps,
      );
      assert.equal(outside !== "no-driver" && outside !== "invalid", true);

      const touching = await authorSortie(
        first.user,
        task("Touching", new Date("2026-08-31T23:00:00.000Z")),
        scheduleDeps,
      );
      assert.equal(touching !== "no-driver" && touching !== "invalid", true);

      const calendar = await readCalendar(first.user, from, to);
      assert.equal(Array.isArray(calendar), true);
      if (!Array.isArray(calendar) || typeof earlier !== "object") {
        return;
      }
      assert.deepEqual(
        calendar.map((item) => item.label),
        ["Earlier", "Crew move"],
      );
      assert.deepEqual(
        calendar.map((item) => item.id),
        [...calendar].sort((left, right) => left.scheduledStart.localeCompare(right.scheduledStart) || left.id.localeCompare(right.id)).map((item) => item.id),
      );

      const otherCalendar = await readCalendar(second.user, from, to);
      assert.deepEqual(otherCalendar, []);

      const stored = await db
        .select({
          type: sortie.type,
          companyId: sortie.companyId,
          authorDriverId: sortie.authorDriverId,
        })
        .from(sortie)
        .where(eq(sortie.id, authored.id));
      assert.equal(stored[0]?.type, "task");
      assert.equal(typeof stored[0]?.companyId, "string");
      assert.equal(stored[0]?.authorDriverId, (await ensureDriver(first.user)).id);

      const createdEvents = await eventsFor(authored.id);
      assert.deepEqual(
        createdEvents.map((event) => event.type),
        ["sortie.created", "sortie.schedule_computed"],
      );
      assert.equal(createdEvents[0]?.label, "Crew move");
    } finally {
      await removeUser(first.user.id);
      await removeUser(second.user.id);
    }
  });

  it("revises a sortie and appends one event, and rejects a sortie with no stop", async () => {
    const person = await createSession({
      sub: `calendar-revise-${crypto.randomUUID()}`,
      displayName: "Reviser",
      email: null,
    });
    const other = await createSession({
      sub: `calendar-other-${crypto.randomUUID()}`,
      displayName: "Other",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      await ensureDriver(other.user);
      const authored = await authorSortie(
        person.user,
        task("Original", new Date("2026-09-03T15:00:00.000Z")),
        scheduleDeps,
      );
      assert.equal(typeof authored === "object", true);
      if (typeof authored !== "object") {
        return;
      }

      const empty = await authorSortie(
        person.user,
        task("Nope", new Date("2026-09-03T15:00:00.000Z"), { stops: [] }),
        scheduleDeps,
      );
      assert.equal(empty, "invalid");
      assert.equal((await eventsFor(authored.id)).length, 1);

      const revised = await reviseSortie(
        person.user,
        authored.id,
        task("Updated", new Date("2026-09-04T15:00:00.000Z")),
        scheduleDeps,
      );
      assert.equal(typeof revised === "object", true);
      if (typeof revised !== "object") {
        return;
      }
      assert.equal(revised.label, "Updated");
      assert.equal(revised.id, authored.id);

      const history = await eventsFor(authored.id);
      assert.deepEqual(
        history.map((event) => event.type),
        ["sortie.created", "sortie.revised"],
      );
      assert.equal(history[1]?.label, "Updated");

      const stolen = await reviseSortie(
        other.user,
        authored.id,
        task("Stolen", new Date("2026-09-04T15:00:00.000Z")),
        scheduleDeps,
      );
      assert.equal(stolen, "not-found");
      assert.equal((await eventsFor(authored.id)).length, 2);

      const missing = await reviseSortie(
        person.user,
        crypto.randomUUID(),
        task("Missing", new Date("2026-09-04T15:00:00.000Z")),
        scheduleDeps,
      );
      assert.equal(missing, "not-found");
    } finally {
      await removeUser(person.user.id);
      await removeUser(other.user.id);
    }
  });

  it("rejects a calendar read and an author before a driver exists", async () => {
    const person = await createSession({
      sub: `calendar-none-${crypto.randomUUID()}`,
      displayName: null,
      email: "none@example.com",
    });

    try {
      const calendar = await readCalendar(
        person.user,
        new Date("2026-09-01T00:00:00.000Z"),
        new Date("2026-10-01T00:00:00.000Z"),
      );
      const authored = await authorSortie(
        person.user,
        task("Early", new Date("2026-09-02T15:00:00.000Z")),
        scheduleDeps,
      );
      assert.equal(calendar, "no-driver");
      assert.equal(authored, "no-driver");
      assert.equal(await driverCount(person.user.id), 0);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("rejects a missing session on every calendar route", async () => {
    const app = Fastify();
    registerCalendarRoutes(app);
    const endpoints = [
      { method: "POST" as const, url: "/drivers/current" },
      { method: "GET" as const, url: "/calendar?from=2026-09-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z" },
      { method: "POST" as const, url: "/sorties" },
      { method: "PATCH" as const, url: `/sorties/${crypto.randomUUID()}` },
      { method: "POST" as const, url: "/location-observations" },
    ];
    for (const endpoint of endpoints) {
      const response = await app.inject(endpoint);
      assert.equal(response.statusCode, 401);
    }
    await app.close();
  });

  it("serves author and revise over HTTP for the session that owns the sortie", async () => {
    const person = await createSession({
      sub: `calendar-http-${crypto.randomUUID()}`,
      displayName: "Http",
      email: null,
    });
    const app = Fastify();
    registerCalendarRoutes(app, scheduleDeps);

    try {
      const ensured = await app.inject({
        method: "POST",
        url: "/drivers/current",
        headers: { authorization: `Bearer ${person.token}` },
      });
      assert.equal(ensured.statusCode, 200);
      const again = await app.inject({
        method: "POST",
        url: "/drivers/current",
        headers: { authorization: `Bearer ${person.token}` },
      });
      assert.equal(again.statusCode, 200);
      assert.equal(again.json().id, ensured.json().id);

      const from = "2026-09-01T00:00:00.000Z";
      const to = "2026-10-01T00:00:00.000Z";
      const observed = await app.inject({
        method: "POST",
        url: "/location-observations",
        headers: { authorization: `Bearer ${person.token}` },
        payload: {
          observedAt: "2026-09-01T12:00:00.000Z",
          latitude: driverFix.latitude,
          longitude: driverFix.longitude,
          accuracyMeters: 8,
        },
      });
      assert.equal(observed.statusCode, 204);

      const created = await app.inject({
        method: "POST",
        url: "/sorties",
        headers: { authorization: `Bearer ${person.token}` },
        payload: taskJson("Http sortie", "2026-09-08T12:00:00.000Z"),
      });
      assert.equal(created.statusCode, 201);
      assert.equal(created.json().arrivalAt, "2026-09-08T12:00:00.000Z");
      assert.equal(created.json().scheduledStart, "2026-09-08T12:00:00.000Z");
      assert.equal(created.json().scheduledEnd, "2026-09-08T13:00:00.000Z");
      assert.equal(created.json().departureAddress, "Driver location");
      const sortieId = created.json().id as string;

      const blank = await app.inject({
        method: "POST",
        url: "/sorties",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { ...taskJson(" ", "2026-09-08T12:00:00.000Z"), stops: [] },
      });
      assert.equal(blank.statusCode, 400);

      const backwards = await app.inject({
        method: "GET",
        url: `/calendar?from=${to}&to=${from}`,
        headers: { authorization: `Bearer ${person.token}` },
      });
      assert.equal(backwards.statusCode, 400);

      const revised = await app.inject({
        method: "PATCH",
        url: `/sorties/${sortieId}`,
        headers: { authorization: `Bearer ${person.token}` },
        payload: taskJson("Http revised", "2026-09-09T12:00:00.000Z"),
      });
      assert.equal(revised.statusCode, 200);

      const calendar = await app.inject({
        method: "GET",
        url: `/calendar?from=${from}&to=${to}`,
        headers: { authorization: `Bearer ${person.token}` },
      });
      assert.equal(calendar.statusCode, 200);
      assert.equal(calendar.json().sorties[0].label, "Http revised");
      assert.equal(calendar.json().sorties[0].type, "task");
      assert.equal(calendar.json().sorties[0].stops.length, 2);
    } finally {
      await app.close();
      await removeUser(person.user.id);
    }
  });

  it("stores passenger fields and ordered stops, and rejects a bad phone or a missing stop", async () => {
    const person = await createSession({
      sub: `calendar-stops-${crypto.randomUUID()}`,
      displayName: "Stops",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      const badPhone = await authorSortie(
        person.user,
        task("Phone", new Date("2026-09-05T15:00:00.000Z"), {
          passengerPhone: "555",
        }),
        scheduleDeps,
      );
      const noStop = await authorSortie(
        person.user,
        task("One", new Date("2026-09-05T15:00:00.000Z"), {
          stops: [],
        }),
        scheduleDeps,
      );
      const singleStop = await authorSortie(
        person.user,
        task("Waypoint", new Date("2026-09-05T15:00:00.000Z"), {
          stops: [waypointStop],
        }),
        scheduleDeps,
      );
      assert.equal(badPhone, "invalid");
      assert.equal(noStop, "invalid");
      assert.equal(typeof singleStop, "object");

      const authored = await authorSortie(
        person.user,
        task("Passenger", new Date("2026-09-05T15:00:00.000Z"), {
          passengerName: "  Ada  ",
          passengerPhone: "5551234567",
          stops: [originStop, waypointStop, destinationStop],
        }),
        scheduleDeps,
      );
      assert.equal(typeof authored === "object", true);
      if (typeof authored !== "object") {
        return;
      }
      assert.equal(authored.passengerName, "Ada");
      assert.equal(authored.passengerPhone, "5551234567");
      assert.deepEqual(
        authored.stops.map((stop) => stop.label),
        ["Origin", "Waypoint", "Destination"],
      );

      const calendar = await readCalendar(
        person.user,
        new Date("2026-09-01T00:00:00.000Z"),
        new Date("2026-10-01T00:00:00.000Z"),
      );
      assert.equal(Array.isArray(calendar), true);
      if (!Array.isArray(calendar)) {
        return;
      }
      const listed = calendar.find((sortie) => sortie.id === authored.id);
      assert.deepEqual(
        listed?.stops.map((stop) => stop.label),
        ["Origin", "Waypoint", "Destination"],
      );

      const created = await eventsFor(authored.id);
      assert.equal(created[0]?.passengerPhone, "5551234567");
      assert.deepEqual(
        created[0]?.stops.map((stop) => stop.label),
        ["Origin", "Waypoint", "Destination"],
      );

      const revised = await reviseSortie(
        person.user,
        authored.id,
        task("Passenger", new Date("2026-09-06T15:00:00.000Z"), {
          passengerName: "Ada",
          passengerPhone: "5551234567",
          stops: [originStop, destinationStop],
        }),
        scheduleDeps,
      );
      assert.equal(typeof revised === "object", true);
      if (typeof revised !== "object") {
        return;
      }
      assert.deepEqual(
        revised.stops.map((stop) => stop.label),
        ["Origin", "Destination"],
      );
      const storedStops = await db
        .select({ label: sortieStop.label, position: sortieStop.position })
        .from(sortieStop)
        .where(eq(sortieStop.sortieId, authored.id))
        .orderBy(sortieStop.position);
      assert.deepEqual(
        storedStops.map((stop) => stop.label),
        ["Origin", "Destination"],
      );
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("rejects an author when the driver has no stored location", async () => {
    const person = await createSession({
      sub: `calendar-noloc-${crypto.randomUUID()}`,
      displayName: "Nowhere",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      const authored = await authorSortie(
        person.user,
        task("Unplaced", new Date("2026-09-02T15:00:00.000Z")),
        scheduleDeps,
      );
      assert.equal(authored, "no-location");
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("sets start and end from the approach and onward drive times", async () => {
    const arrival = new Date("2026-09-02T15:00:00.000Z");
    const departures: string[] = [];
    const window = await computeWindow(
      driverFix,
      [originStop, waypointStop, destinationStop],
      arrival,
      scheduleNow,
      async (origin, destination, intermediates, departure) => {
        if (destination.latitude === originStop.latitude && origin.latitude === driverFix.latitude) {
          departures.push(departure.toISOString());
          return departures.length === 1 ? 1800 : 2400;
        }
        assert.equal(origin.latitude, originStop.latitude);
        assert.equal(destination.latitude, destinationStop.latitude);
        assert.equal(intermediates.length, 1);
        assert.equal(intermediates[0]?.latitude, waypointStop.latitude);
        return 5400;
      },
    );
    assert.equal(typeof window, "object");
    if (typeof window !== "object") {
      return;
    }
    assert.deepEqual(departures, ["2026-09-02T15:00:00.000Z", "2026-09-02T14:30:00.000Z"]);
    assert.equal(window.scheduledStart.toISOString(), "2026-09-02T14:20:00.000Z");
    assert.equal(window.scheduledEnd.toISOString(), "2026-09-02T16:30:00.000Z");
  });

  it("keeps the cached window until the driver moves five miles, then recomputes it", async () => {
    const person = await createSession({
      sub: `calendar-move-${crypto.randomUUID()}`,
      displayName: "Mover",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      let approach = 1800;
      const deps: ScheduleDeps = {
        now: () => scheduleNow,
        driveDuration: async (origin, destination) =>
          destination.latitude === originStop.latitude && origin.latitude !== originStop.latitude ? approach : 3600,
      };
      const arrival = new Date("2026-09-02T15:00:00.000Z");
      const authored = await authorSortie(person.user, task("Window", arrival), deps);
      assert.equal(typeof authored, "object");
      if (typeof authored !== "object") {
        return;
      }
      assert.equal(authored.scheduledStart, "2026-09-02T14:30:00.000Z");
      assert.equal(authored.scheduledEnd, "2026-09-02T16:00:00.000Z");

      const near = await recordObservation(
        person.user,
        {
          observedAt: new Date("2026-09-01T13:00:00.000Z"),
          latitude: 40.05,
          longitude: -74,
          accuracyMeters: 10,
        },
        deps,
      );
      assert.equal(near, "ok");
      const still = await readCalendar(person.user, scheduleNow, new Date("2026-10-01T00:00:00.000Z"));
      assert.equal(Array.isArray(still), true);
      if (!Array.isArray(still)) {
        return;
      }
      assert.equal(still[0]?.scheduledStart, "2026-09-02T14:30:00.000Z");

      approach = 7200;
      const far = await recordObservation(
        person.user,
        {
          observedAt: new Date("2026-09-01T14:00:00.000Z"),
          latitude: 40.2,
          longitude: -74,
          accuracyMeters: 10,
        },
        deps,
      );
      assert.equal(far, "ok");
      const moved = await readCalendar(person.user, scheduleNow, new Date("2026-10-01T00:00:00.000Z"));
      assert.equal(Array.isArray(moved), true);
      if (!Array.isArray(moved)) {
        return;
      }
      assert.equal(moved[0]?.arrivalAt, arrival.toISOString());
      assert.equal(moved[0]?.scheduledStart, "2026-09-02T13:00:00.000Z");
      assert.equal(moved[0]?.scheduledEnd, "2026-09-02T16:00:00.000Z");
      assert.deepEqual(
        (await eventsFor(authored.id)).map((event) => event.type),
        ["sortie.created", "sortie.schedule_computed"],
      );
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("leaves an ended sortie and a failed recompute unchanged", async () => {
    const person = await createSession({
      sub: `calendar-ended-${crypto.randomUUID()}`,
      displayName: "Ended",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      let fail = false;
      let calls = 0;
      const deps: ScheduleDeps = {
        now: () => scheduleNow,
        driveDuration: async (origin, destination) => {
          calls += 1;
          if (fail) {
            return "failed";
          }
          return destination.latitude === originStop.latitude && origin.latitude !== originStop.latitude ? 0 : 3600;
        },
      };
      const authored = await authorSortie(
        person.user,
        task("Open", new Date("2026-09-02T15:00:00.000Z")),
        deps,
      );
      assert.equal(typeof authored, "object");
      if (typeof authored !== "object") {
        return;
      }

      const ended = await authorSortie(
        person.user,
        task("Closed", new Date("2026-09-08T15:00:00.000Z")),
        {
          ...deps,
          now: () => new Date("2026-09-10T00:00:00.000Z"),
        },
      );
      assert.equal(typeof ended, "object");
      if (typeof ended !== "object") {
        return;
      }
      const endedStart = ended.scheduledStart;

      calls = 0;
      const afterEnd = await recordObservation(
        person.user,
        {
          observedAt: new Date("2026-09-10T12:00:00.000Z"),
          latitude: 40.2,
          longitude: -74,
          accuracyMeters: 10,
        },
        { ...deps, now: () => new Date("2026-09-10T00:00:00.000Z") },
      );
      assert.equal(afterEnd, "ok");
      assert.equal(calls, 0);
      const closed = await db
        .select({ scheduledStart: sortie.scheduledStart })
        .from(sortie)
        .where(eq(sortie.id, ended.id));
      assert.equal(closed[0]?.scheduledStart.toISOString(), endedStart);

      fail = true;
      calls = 0;
      const missed = await recordObservation(
        person.user,
        {
          observedAt: new Date("2026-09-01T15:00:00.000Z"),
          latitude: 40.2,
          longitude: -74,
          accuracyMeters: 10,
        },
        deps,
      );
      assert.equal(missed, "ok");
      assert.ok(calls > 0);
      const kept = await db
        .select({
          scheduledStart: sortie.scheduledStart,
          scheduleOriginLatitude: sortie.scheduleOriginLatitude,
        })
        .from(sortie)
        .where(eq(sortie.id, authored.id));
      assert.equal(kept[0]?.scheduledStart.toISOString(), authored.scheduledStart);
      assert.equal(kept[0]?.scheduleOriginLatitude, driverFix.latitude);

      calls = 0;
      const backedOff = await recordObservation(
        person.user,
        {
          observedAt: new Date("2026-09-01T15:01:00.000Z"),
          latitude: 40.25,
          longitude: -74,
          accuracyMeters: 10,
        },
        deps,
      );
      assert.equal(backedOff, "ok");
      assert.equal(calls, 0);

      const unavailable = await authorSortie(
        person.user,
        task("Blocked", new Date("2026-09-03T15:00:00.000Z")),
        deps,
      );
      assert.equal(unavailable, "unavailable");
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("accepts one address and computes an immediate arrival when no time is sent", async () => {
    const person = await createSession({
      sub: `calendar-one-${crypto.randomUUID()}`,
      displayName: "One",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      const pickup = await authorSortie(
        person.user,
        task("", null, { stops: [originStop] }),
        scheduleDeps,
      );
      assert.equal(typeof pickup, "object");
      if (typeof pickup !== "object") {
        return;
      }
      assert.equal(pickup.label, "");
      assert.equal(pickup.arrivalAuthored, false);
      assert.equal(pickup.arrivalAt, scheduleNow.toISOString());
      assert.equal(pickup.scheduledStart, scheduleNow.toISOString());
      assert.equal(pickup.scheduledEnd, scheduleNow.toISOString());
      assert.equal(pickup.stops[0]?.passenger, false);
      assert.equal(pickup.stops[0]?.label, "Origin");

      const destination = await authorSortie(
        person.user,
        task("", null, { stops: [destinationStop] }),
        scheduleDeps,
      );
      assert.equal(typeof destination, "object");
      if (typeof destination !== "object") {
        return;
      }
      assert.equal(destination.arrivalAuthored, false);
      assert.equal(destination.arrivalAt, "2026-09-01T01:00:00.000Z");
      assert.equal(destination.scheduledStart, scheduleNow.toISOString());
      assert.equal(destination.scheduledEnd, "2026-09-01T01:00:00.000Z");
      assert.equal(destination.stops[0]?.passenger, true);
      assert.equal(destination.stops[0]?.label, "Destination");

      const authoredPickup = new Date("2026-09-02T15:00:00.000Z");
      const held = await authorSortie(
        person.user,
        task("", authoredPickup, { stops: [originStop] }),
        scheduleDeps,
      );
      assert.equal(typeof held, "object");
      if (typeof held !== "object") {
        return;
      }
      assert.equal(held.arrivalAuthored, true);
      assert.equal(held.arrivalAt, authoredPickup.toISOString());
      assert.equal(held.scheduledStart, authoredPickup.toISOString());
      assert.equal(held.scheduledEnd, authoredPickup.toISOString());
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("starts a later sortie from the previous sortie's destination", async () => {
    const person = await createSession({
      sub: `calendar-chain-${crypto.randomUUID()}`,
      displayName: "Chain",
      email: null,
    });
    const laterOrigin = {
      label: "Later origin",
      latitude: 41,
      longitude: -73,
      waitMinutes: 0,
      passenger: false,
    };
    const laterDestination = {
      label: "Later destination",
      latitude: 41.2,
      longitude: -73.2,
      waitMinutes: 0,
      passenger: true,
    };

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      const deps: ScheduleDeps = {
        now: () => scheduleNow,
        lookupAddress: async () => "Driver location",
        driveDuration: async (origin, destination) => {
          if (destination.latitude === laterOrigin.latitude && origin.latitude === destinationStop.latitude) {
            return 1800;
          }
          if (destination.latitude === originStop.latitude && origin.latitude === driverFix.latitude) {
            return 0;
          }
          return 3600;
        },
      };
      const first = await authorSortie(person.user, task("First", new Date("2026-09-02T15:00:00.000Z")), deps);
      assert.equal(typeof first, "object");
      if (typeof first !== "object") {
        return;
      }
      assert.equal(first.scheduledStart, "2026-09-02T15:00:00.000Z");
      assert.equal(first.departureAddress, "Driver location");

      const secondArrival = new Date("2026-09-02T18:00:00.000Z");
      const second = await authorSortie(
        person.user,
        task("Second", secondArrival, { stops: [laterOrigin, laterDestination] }),
        deps,
      );
      assert.equal(typeof second, "object");
      if (typeof second !== "object") {
        return;
      }
      assert.equal(second.scheduledStart, "2026-09-02T17:30:00.000Z");
      assert.equal(second.scheduledEnd, "2026-09-02T19:00:00.000Z");
      assert.equal(second.departureAddress, destinationStop.label);
      const anchor = await db
        .select({ latitude: sortie.scheduleOriginLatitude })
        .from(sortie)
        .where(eq(sortie.id, second.id));
      assert.equal(anchor[0]?.latitude, destinationStop.latitude);

      const moved = await recordObservation(
        person.user,
        {
          observedAt: new Date("2026-09-01T16:00:00.000Z"),
          latitude: 40.2,
          longitude: -74,
          accuracyMeters: 10,
        },
        deps,
      );
      assert.equal(moved, "ok");
      const kept = await db
        .select({ scheduledStart: sortie.scheduledStart })
        .from(sortie)
        .where(eq(sortie.id, second.id));
      assert.equal(kept[0]?.scheduledStart.toISOString(), second.scheduledStart);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("starts a one-stop sortie from GPS C to D ten minutes before arrival T", async () => {
    const person = await createSession({
      sub: `calendar-line-cd-${crypto.randomUUID()}`,
      displayName: "Line CD",
      email: null,
    });
    const calls: DriveCall[] = [];

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id, pointC);
      const deps: ScheduleDeps = {
        now: () => scheduleNow,
        lookupAddress: async () => "Driver location",
        driveDuration: lineDriveDuration(calls),
      };
      const authored = await authorSortie(
        person.user,
        {
          label: "C to D",
          arrivalAt: lineT,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointD, "D", true)],
        },
        deps,
      );
      assert.equal(typeof authored, "object");
      if (typeof authored !== "object") {
        return;
      }
      assert.equal(authored.arrivalAt, lineT.toISOString());
      assert.equal(authored.scheduledStart, new Date(lineT.getTime() - hopSeconds * 1000).toISOString());
      assert.equal(authored.scheduledEnd, lineT.toISOString());
      assert.ok(
        calls.some(
          (call) =>
            call.origin.latitude === pointC.latitude &&
            call.origin.longitude === pointC.longitude &&
            call.destination.latitude === pointD.latitude &&
            call.destination.longitude === pointD.longitude &&
            call.intermediates.length === 0,
        ),
      );
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("recomputes Stan's approach from Brittany's destination D on the A–E line", async () => {
    const person = await createSession({
      sub: `calendar-line-stan-${crypto.randomUUID()}`,
      displayName: "Line Stan",
      email: null,
    });
    const calls: DriveCall[] = [];
    const brittanyArrival = new Date(lineT.getTime() + 20 * 60 * 1000);
    const stanArrival = new Date(lineT.getTime() + 120 * 60 * 1000);

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id, pointA);
      const deps: ScheduleDeps = {
        now: () => scheduleNow,
        lookupAddress: async () => "Driver location",
        driveDuration: lineDriveDuration(calls),
      };

      const stan = await authorSortie(
        person.user,
        {
          label: "Stan",
          arrivalAt: stanArrival,
          passengerName: "Stan",
          passengerPhone: null,
          stops: [lineStop(pointA, "A", false), lineStop(pointB, "B", true)],
        },
        deps,
      );
      assert.equal(typeof stan, "object");
      if (typeof stan !== "object") {
        return;
      }

      const brittany = await authorSortie(
        person.user,
        {
          label: "Brittany",
          arrivalAt: brittanyArrival,
          passengerName: "Brittany",
          passengerPhone: null,
          stops: [lineStop(pointC, "C", false), lineStop(pointD, "D", true)],
        },
        deps,
      );
      assert.equal(typeof brittany, "object");
      if (typeof brittany !== "object") {
        return;
      }
      assert.equal(brittany.passengerName, "Brittany");
      assert.equal(brittany.arrivalAt, brittanyArrival.toISOString());
      assert.equal(brittany.scheduledStart, lineT.toISOString());
      assert.equal(brittany.scheduledEnd, new Date(lineT.getTime() + 30 * 60 * 1000).toISOString());
      assert.ok(
        calls.some(
          (call) =>
            call.origin.latitude === pointA.latitude &&
            call.destination.latitude === pointC.latitude &&
            call.intermediates.length === 0,
        ),
      );

      const calendar = await readCalendar(person.user, scheduleNow, new Date("2026-10-01T00:00:00.000Z"));
      assert.equal(Array.isArray(calendar), true);
      if (!Array.isArray(calendar)) {
        return;
      }
      const stanAfter = calendar.find((item) => item.passengerName === "Stan");
      assert.ok(stanAfter);
      assert.equal(stanAfter.arrivalAt, stanArrival.toISOString());
      assert.equal(stanAfter.scheduledStart, new Date(lineT.getTime() + 90 * 60 * 1000).toISOString());
      assert.equal(stanAfter.scheduledEnd, new Date(lineT.getTime() + 130 * 60 * 1000).toISOString());
      assert.equal(stanAfter.departureAddress, "D");
      const stanAnchor = await db
        .select({
          latitude: sortie.scheduleOriginLatitude,
          longitude: sortie.scheduleOriginLongitude,
        })
        .from(sortie)
        .where(eq(sortie.id, stan.id));
      assert.equal(stanAnchor[0]?.latitude, pointD.latitude);
      assert.equal(stanAnchor[0]?.longitude, pointD.longitude);
      assert.ok(
        calls.some(
          (call) =>
            call.origin.latitude === pointD.latitude &&
            call.origin.longitude === pointD.longitude &&
            call.destination.latitude === pointA.latitude &&
            call.destination.longitude === pointA.longitude &&
            call.intermediates.length === 0,
        ),
      );
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("includes stop wait minutes in the scheduled end and onward departure", async () => {
    const arrival = new Date("2026-09-02T15:00:00.000Z");
    const departures: string[] = [];
    const window = await computeWindow(
      driverFix,
      [
        { ...originStop, waitMinutes: 10 },
        { ...waypointStop, waitMinutes: 5 },
        { ...destinationStop, waitMinutes: 15 },
      ],
      arrival,
      scheduleNow,
      async (origin, destination, _intermediates, departure) => {
        departures.push(departure.toISOString());
        if (destination.latitude === originStop.latitude && origin.latitude === driverFix.latitude) {
          return 1800;
        }
        return 3600;
      },
    );
    assert.equal(typeof window, "object");
    if (typeof window !== "object") {
      return;
    }
    assert.ok(departures.includes("2026-09-02T15:10:00.000Z"));
    assert.equal(window.scheduledStart.toISOString(), "2026-09-02T14:30:00.000Z");
    assert.equal(window.scheduledEnd.toISOString(), "2026-09-02T16:30:00.000Z");
  });

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

  it("infers stop arrival and departure from GPS and completes with actualEnd", async () => {
    const person = await createSession({
      sub: `calendar-actuals-${crypto.randomUUID()}`,
      displayName: "Actuals",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      const arrival = new Date("2026-09-02T15:00:00.000Z");
      const authored = await authorSortie(
        person.user,
        task("Trip", arrival, { stops: [originStop, destinationStop] }),
        scheduleDeps,
      );
      assert.equal(typeof authored, "object");
      if (typeof authored !== "object") {
        return;
      }

      const commenceNow = new Date("2026-09-02T14:20:00.000Z");
      const commenced = await commenceSortie(person.user, authored.id, {
        ...scheduleDeps,
        now: () => commenceNow,
      });
      assert.equal(typeof commenced, "object");
      if (typeof commenced !== "object") {
        return;
      }

      const arrivedAt = new Date("2026-09-02T15:01:00.000Z");
      assert.equal(
        await recordObservation(
          person.user,
          {
            observedAt: arrivedAt,
            latitude: originStop.latitude,
            longitude: originStop.longitude,
            accuracyMeters: 5,
            sortieId: authored.id,
          },
          scheduleDeps,
        ),
        "ok",
      );

      const afterArrive = await readCalendar(
        person.user,
        new Date("2026-09-02T12:00:00.000Z"),
        new Date("2026-09-02T20:00:00.000Z"),
      );
      assert.ok(Array.isArray(afterArrive));
      if (!Array.isArray(afterArrive)) {
        return;
      }
      const inProgress = afterArrive.find((item) => item.id === authored.id);
      assert.ok(inProgress);
      assert.equal(inProgress?.stops[0]?.actualArrivedAt, arrivedAt.toISOString());
      assert.equal(inProgress?.stops[0]?.actualDepartedAt, null);
      assert.equal(inProgress?.stops[1]?.actualArrivedAt, null);
      assert.equal(inProgress?.actualEnd, null);

      const leftAt = new Date("2026-09-02T15:08:00.000Z");
      assert.equal(
        await recordObservation(
          person.user,
          {
            observedAt: leftAt,
            latitude: originStop.latitude + 0.001,
            longitude: originStop.longitude,
            accuracyMeters: 5,
            sortieId: authored.id,
          },
          scheduleDeps,
        ),
        "ok",
      );

      const afterLeave = await readCalendar(
        person.user,
        new Date("2026-09-02T12:00:00.000Z"),
        new Date("2026-09-02T20:00:00.000Z"),
      );
      assert.ok(Array.isArray(afterLeave));
      if (!Array.isArray(afterLeave)) {
        return;
      }
      const mid = afterLeave.find((item) => item.id === authored.id);
      assert.equal(mid?.stops[0]?.actualDepartedAt, leftAt.toISOString());
      assert.equal(mid?.stops[1]?.actualArrivedAt, null);

      const atDestination = new Date("2026-09-02T16:00:00.000Z");
      assert.equal(
        await recordObservation(
          person.user,
          {
            observedAt: atDestination,
            latitude: destinationStop.latitude,
            longitude: destinationStop.longitude,
            accuracyMeters: 5,
            sortieId: authored.id,
          },
          scheduleDeps,
        ),
        "ok",
      );
      const atEnd = await readCalendar(
        person.user,
        new Date("2026-09-02T12:00:00.000Z"),
        new Date("2026-09-02T20:00:00.000Z"),
      );
      assert.ok(Array.isArray(atEnd));
      if (!Array.isArray(atEnd)) {
        return;
      }
      const arrivedFinal = atEnd.find((item) => item.id === authored.id);
      assert.equal(arrivedFinal?.stops[1]?.actualArrivedAt, atDestination.toISOString());
      assert.equal(arrivedFinal?.actualEnd, null);

      const completeNow = new Date("2026-09-02T16:05:00.000Z");
      const completed = await completeSortie(person.user, authored.id, {
        ...scheduleDeps,
        now: () => completeNow,
      });
      assert.equal(typeof completed, "object");
      if (typeof completed !== "object") {
        return;
      }
      assert.equal(completed.actualEnd, completeNow.toISOString());
      assert.equal(completed.stops[1]?.actualDepartedAt, completeNow.toISOString());

      const again = await completeSortie(person.user, authored.id, {
        ...scheduleDeps,
        now: () => new Date("2026-09-02T16:10:00.000Z"),
      });
      assert.equal(typeof again, "object");
      if (typeof again !== "object") {
        return;
      }
      assert.equal(again.actualEnd, completeNow.toISOString());

      const observations = await db
        .select({ sortieId: locationObservation.sortieId })
        .from(locationObservation)
        .innerJoin(driver, eq(driver.id, locationObservation.driverId))
        .where(eq(driver.userId, person.user.id));
      assert.ok(observations.some((row) => row.sortieId === authored.id));

      const events = await eventsFor(authored.id);
      assert.ok(events.some((event) => event.type === "sortie.stop_arrival_inferred"));
      assert.ok(events.some((event) => event.type === "sortie.stop_departure_inferred"));
      assert.ok(events.some((event) => event.type === "sortie.completed"));

      const revised = await reviseSortie(person.user, authored.id, task("Trip", arrival), scheduleDeps);
      assert.equal(typeof revised, "object");
      if (typeof revised !== "object") {
        return;
      }
      assert.equal(revised.actualStart, null);
      assert.equal(revised.actualEnd, null);
      assert.equal(revised.stops[0]?.actualArrivedAt, null);
      assert.equal(revised.stops[0]?.actualDepartedAt, null);
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

  it("does not recompute a commenced sortie from a later GPS fix", async () => {
    const person = await createSession({
      sub: `calendar-sealed-${crypto.randomUUID()}`,
      displayName: "Sealed",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      let approach = 1800;
      const deps: ScheduleDeps = {
        now: () => scheduleNow,
        driveDuration: async (origin, destination) =>
          destination.latitude === originStop.latitude && origin.latitude !== originStop.latitude ? approach : 3600,
      };
      const arrival = new Date("2026-09-02T15:00:00.000Z");
      const authored = await authorSortie(person.user, task("Frozen", arrival), deps);
      assert.equal(typeof authored, "object");
      if (typeof authored !== "object") {
        return;
      }
      const commenced = await commenceSortie(person.user, authored.id, {
        ...deps,
        now: () => new Date("2026-09-02T14:20:00.000Z"),
      });
      assert.equal(typeof commenced, "object");
      if (typeof commenced !== "object") {
        return;
      }
      approach = 600;
      const moved = await recordObservation(
        person.user,
        {
          observedAt: new Date("2026-09-01T14:00:00.000Z"),
          latitude: 40.2,
          longitude: -74,
          accuracyMeters: 10,
        },
        deps,
      );
      assert.equal(moved, "ok");
      const kept = await db
        .select({ scheduledStart: sortie.scheduledStart, actualStart: sortie.actualStart })
        .from(sortie)
        .where(eq(sortie.id, authored.id));
      assert.equal(kept[0]?.scheduledStart.toISOString(), commenced.scheduledStart);
      assert.equal(kept[0]?.actualStart?.toISOString(), commenced.actualStart);
    } finally {
      await removeUser(person.user.id);
    }
  });
});

async function companiesFor(userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: company.name })
    .from(company)
    .innerJoin(driverCompany, eq(driverCompany.companyId, company.id))
    .innerJoin(driver, eq(driver.id, driverCompany.driverId))
    .where(eq(driver.userId, userId));
  return rows.map((row) => row.name);
}

async function driverCount(userId: string): Promise<number> {
  const rows = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  return rows.length;
}

async function eventsFor(
  sortieId: string,
): Promise<{ type: string; label: string; passengerPhone: string | null; stops: { label: string }[] }[]> {
  return db
    .select({
      type: operationalEvent.type,
      label: operationalEvent.label,
      passengerPhone: operationalEvent.passengerPhone,
      stops: operationalEvent.stops,
    })
    .from(operationalEvent)
    .where(eq(operationalEvent.sortieId, sortieId))
    .orderBy(operationalEvent.recordedAt);
}

const originStop = {
  label: "Origin",
  latitude: 40.7128,
  longitude: -74.006,
  waitMinutes: 0,
  passenger: false,
};
const destinationStop = {
  label: "Destination",
  latitude: 40.758,
  longitude: -73.9855,
  waitMinutes: 0,
  passenger: true,
};
const waypointStop = {
  label: "Waypoint",
  latitude: 40.73,
  longitude: -73.99,
  waitMinutes: 0,
  passenger: true,
};

const driverFix = { latitude: 40, longitude: -74 };
const scheduleNow = new Date("2026-09-01T00:00:00.000Z");

const hopMeters = 10 * 1609.344;
const hopSeconds = 600;
const lineT = new Date("2026-09-02T15:00:00.000Z");
const pointA = { latitude: 40, longitude: -74 };
const pointB = northOf(pointA, hopMeters);
const pointC = northOf(pointB, hopMeters);
const pointD = northOf(pointC, hopMeters);
const pointE = northOf(pointD, hopMeters);
const linePoints = [pointA, pointB, pointC, pointD, pointE];

type DriveCall = {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  intermediates: { latitude: number; longitude: number }[];
};

const scheduleDeps: ScheduleDeps = {
  now: () => scheduleNow,
  driveDuration: async (origin, destination) =>
    destination.latitude === originStop.latitude && origin.latitude !== originStop.latitude ? 0 : 3600,
  lookupAddress: async () => "Driver location",
};

function northOf(
  from: { latitude: number; longitude: number },
  meters: number,
): { latitude: number; longitude: number } {
  return { latitude: from.latitude + meters / 111_320, longitude: from.longitude };
}

function lineStop(
  point: { latitude: number; longitude: number },
  label: string,
  passenger: boolean,
): SortieInput["stops"][number] {
  return {
    label,
    latitude: point.latitude,
    longitude: point.longitude,
    waitMinutes: 0,
    passenger,
  };
}

function lineIndex(coordinate: { latitude: number; longitude: number }): number | null {
  const index = linePoints.findIndex(
    (point) => point.latitude === coordinate.latitude && point.longitude === coordinate.longitude,
  );
  return index >= 0 ? index : null;
}

function lineDriveDuration(calls: DriveCall[]): ScheduleDeps["driveDuration"] {
  return async (origin, destination, intermediates) => {
    calls.push({
      origin: { latitude: origin.latitude, longitude: origin.longitude },
      destination: { latitude: destination.latitude, longitude: destination.longitude },
      intermediates: intermediates.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
      })),
    });
    const from = lineIndex(origin);
    const to = lineIndex(destination);
    assert.notEqual(from, null);
    assert.notEqual(to, null);
    if (from === null || to === null) {
      return "failed";
    }
    return Math.abs(to - from) * hopSeconds;
  };
}

function task(label: string, arrivalAt: Date | null, extra?: Partial<SortieInput>): SortieInput {
  return {
    label,
    arrivalAt,
    passengerName: null,
    passengerPhone: null,
    stops: [originStop, destinationStop],
    ...extra,
  };
}

function taskJson(label: string, arrivalAt: string) {
  return {
    label,
    arrivalAt,
    passengerName: null,
    passengerPhone: null,
    stops: [originStop, destinationStop],
  };
}

async function placeDriver(
  userId: string,
  coordinate: { latitude: number; longitude: number } = driverFix,
): Promise<void> {
  const rows = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  const row = rows[0];
  if (!row) {
    throw new Error("driver missing");
  }
  await db.insert(locationObservation).values({
    driverId: row.id,
    observedAt: new Date("2026-09-01T12:00:00.000Z"),
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    accuracyMeters: 8,
  });
}

async function removeUser(userId: string): Promise<void> {
  const drivers = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  for (const row of drivers) {
    await db.delete(locationObservation).where(eq(locationObservation.driverId, row.id));
    const sorties = await db.select({ id: sortie.id }).from(sortie).where(eq(sortie.authorDriverId, row.id));
    for (const item of sorties) {
      await db.delete(operationalEvent).where(eq(operationalEvent.sortieId, item.id));
      await db.delete(sortieStop).where(eq(sortieStop.sortieId, item.id));
    }
    await db.delete(sortie).where(eq(sortie.authorDriverId, row.id));
    await db.delete(driverTariff).where(eq(driverTariff.driverId, row.id));
    const links = await db
      .select({ companyId: driverCompany.companyId })
      .from(driverCompany)
      .where(eq(driverCompany.driverId, row.id));
    await db.delete(driverCompany).where(eq(driverCompany.driverId, row.id));
    await db.delete(driver).where(eq(driver.id, row.id));
    for (const link of links) {
      await db.delete(company).where(eq(company.id, link.companyId));
    }
  }
  await db.delete(session).where(eq(session.userId, userId));
  await db.delete(userCredential).where(eq(userCredential.userId, userId));
  await db.delete(user).where(eq(user.id, userId));
}
