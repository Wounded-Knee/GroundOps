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

describe("sortie authoring", () => {
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
      { method: "POST" as const, url: "/sorties/preview" },
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

  it("lists a later sortie whose arrival no longer fits the draft", async () => {
    const person = await createSession({
      sub: `calendar-preview-tight-${crypto.randomUUID()}`,
      displayName: "Preview tight",
      email: null,
    });
    const calls: DriveCall[] = [];

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
          arrivalAt: new Date(lineT.getTime() + 40 * 60 * 1000),
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointA, "A", false), lineStop(pointB, "B", true)],
        },
        deps,
      );
      assert.equal(typeof stan, "object");
      if (typeof stan !== "object") {
        return;
      }
      const before = await eventsFor(stan.id);
      const preview = await previewSortie(
        person.user,
        {
          label: "Brittany",
          arrivalAt: new Date(lineT.getTime() + 20 * 60 * 1000),
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointC, "C", false), lineStop(pointD, "D", true)],
        },
        null,
        deps,
      );
      assert.deepEqual(preview, { endangered: [{ id: stan.id, label: "Stan" }] });
      const after = await eventsFor(stan.id);
      assert.deepEqual(after, before);
      const driverId = (await ensureDriver(person.user)).id;
      const stored = await db.select({ id: sortie.id }).from(sortie).where(eq(sortie.authorDriverId, driverId));
      assert.deepEqual(
        stored.map((row) => row.id),
        [stan.id],
      );
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("does not list a later sortie that still fits around the draft", async () => {
    const person = await createSession({
      sub: `calendar-preview-gap-${crypto.randomUUID()}`,
      displayName: "Preview gap",
      email: null,
    });
    const calls: DriveCall[] = [];

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
          arrivalAt: new Date(lineT.getTime() + 120 * 60 * 1000),
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointA, "A", false), lineStop(pointB, "B", true)],
        },
        deps,
      );
      assert.equal(typeof stan, "object");
      if (typeof stan !== "object") {
        return;
      }
      const preview = await previewSortie(
        person.user,
        {
          label: "Brittany",
          arrivalAt: new Date(lineT.getTime() + 20 * 60 * 1000),
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointC, "C", false), lineStop(pointD, "D", true)],
        },
        null,
        deps,
      );
      assert.deepEqual(preview, { endangered: [] });
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("does not list the sortie being revised", async () => {
    const person = await createSession({
      sub: `calendar-preview-revise-${crypto.randomUUID()}`,
      displayName: "Preview revise",
      email: null,
    });
    const calls: DriveCall[] = [];

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
          label: "",
          arrivalAt: new Date(lineT.getTime() + 40 * 60 * 1000),
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointA, "A", false), lineStop(pointB, "B", true)],
        },
        deps,
      );
      const brittany = await authorSortie(
        person.user,
        {
          label: "Brittany",
          arrivalAt: new Date(lineT.getTime() + 20 * 60 * 1000),
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointC, "C", false), lineStop(pointD, "D", true)],
        },
        deps,
      );
      assert.equal(typeof stan, "object");
      assert.equal(typeof brittany, "object");
      if (typeof stan !== "object" || typeof brittany !== "object") {
        return;
      }
      const preview = await previewSortie(
        person.user,
        {
          label: "Brittany",
          arrivalAt: new Date(lineT.getTime() + 20 * 60 * 1000),
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointC, "C", false), lineStop(pointD, "D", true)],
        },
        brittany.id,
        deps,
      );
      assert.deepEqual(preview, { endangered: [{ id: stan.id, label: "A" }] });
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("returns no endangered sorties when the draft itself has no route", async () => {
    const person = await createSession({
      sub: `calendar-preview-unrouted-${crypto.randomUUID()}`,
      displayName: "Preview unrouted",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id, pointA);
      const deps: ScheduleDeps = {
        now: () => scheduleNow,
        lookupAddress: async () => "Driver location",
        driveDuration: async (origin, destination) => (destination.latitude === 12 ? "failed" : 600),
      };
      const stan = await authorSortie(
        person.user,
        {
          label: "Stan",
          arrivalAt: new Date(lineT.getTime() + 40 * 60 * 1000),
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointA, "A", false)],
        },
        deps,
      );
      assert.equal(typeof stan, "object");
      if (typeof stan !== "object") {
        return;
      }
      const preview = await previewSortie(
        person.user,
        {
          label: "Nowhere",
          arrivalAt: lineT,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop({ latitude: 12, longitude: -74 }, "Nowhere", true)],
        },
        null,
        deps,
      );
      assert.deepEqual(preview, { endangered: [] });
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("does not list a sortie that was just ended when previewing an immediate reposition", async () => {
    const person = await createSession({
      sub: `calendar-preview-ended-${crypto.randomUUID()}`,
      displayName: "Preview ended",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      const arrival = new Date("2026-09-02T15:00:00.000Z");
      const authored = await authorSortie(person.user, task("Trip", arrival), scheduleDeps);
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
      assert.equal(commenced.scheduledEnd, "2026-09-02T16:00:00.000Z");

      const completeNow = new Date("2026-09-02T15:10:00.000Z");
      const completed = await completeSortie(person.user, authored.id, {
        ...scheduleDeps,
        now: () => completeNow,
      });
      assert.equal(typeof completed, "object");
      if (typeof completed !== "object") {
        return;
      }
      assert.equal(completed.actualEnd, completeNow.toISOString());

      const preview = await previewSortie(
        person.user,
        {
          label: "",
          arrivalAt: null,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop({ latitude: 41, longitude: -73 }, "Elsewhere", false)],
        },
        null,
        { ...scheduleDeps, now: () => completeNow },
      );
      assert.deepEqual(preview, { endangered: [] });
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("requires a location to preview an immediate departure", async () => {
    const person = await createSession({
      sub: `calendar-preview-location-${crypto.randomUUID()}`,
      displayName: "Preview location",
      email: null,
    });

    try {
      await ensureDriver(person.user);
      const preview = await previewSortie(
        person.user,
        {
          label: "",
          arrivalAt: null,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointD, "D", true)],
        },
        null,
        scheduleDeps,
      );
      assert.equal(preview, "no-location");
    } finally {
      await removeUser(person.user.id);
    }
  });
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
});
