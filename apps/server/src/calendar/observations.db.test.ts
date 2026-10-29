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

describe("sortie observations", () => {
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
  it("drives a future sortie from the current fix after an earlier sortie has ended", async () => {
    const person = await createSession({
      sub: `calendar-ended-origin-${crypto.randomUUID()}`,
      displayName: "Ended origin",
      email: null,
    });
    const calls: DriveCall[] = [];
    const pastArrival = new Date("2026-09-02T10:00:00.000Z");
    const futureArrival = new Date("2026-09-02T18:00:00.000Z");
    const now = new Date("2026-09-02T12:00:00.000Z");

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id, pointB);
      const deps: ScheduleDeps = {
        now: () => now,
        lookupAddress: async () => "Driver location",
        driveDuration: lineDriveDuration(calls),
      };
      const past = await authorSortie(
        person.user,
        {
          label: "Past",
          arrivalAt: pastArrival,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointA, "A", true)],
        },
        deps,
      );
      assert.equal(typeof past, "object");
      if (typeof past !== "object") {
        return;
      }
      assert.equal(past.scheduledEnd, pastArrival.toISOString());

      const future = await authorSortie(
        person.user,
        {
          label: "Future",
          arrivalAt: futureArrival,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointC, "C", true)],
        },
        deps,
      );
      assert.equal(typeof future, "object");
      if (typeof future !== "object") {
        return;
      }
      assert.equal(future.scheduledStart, new Date(futureArrival.getTime() - hopSeconds * 1000).toISOString());
      assert.equal(future.departureAddress, "Driver location");
      const anchor = await db
        .select({
          latitude: sortie.scheduleOriginLatitude,
          longitude: sortie.scheduleOriginLongitude,
        })
        .from(sortie)
        .where(eq(sortie.id, future.id));
      assert.equal(anchor[0]?.latitude, pointB.latitude);
      assert.equal(anchor[0]?.longitude, pointB.longitude);
      assert.ok(
        calls.some(
          (call) =>
            call.origin.latitude === pointB.latitude &&
            call.origin.longitude === pointB.longitude &&
            call.destination.latitude === pointC.latitude &&
            call.destination.longitude === pointC.longitude,
        ),
      );
    } finally {
      await removeUser(person.user.id);
    }
  });
  it("recomputes a chained sortie from a nearby fix once the predecessor has ended", async () => {
    const person = await createSession({
      sub: `calendar-ended-nearby-${crypto.randomUUID()}`,
      displayName: "Ended nearby",
      email: null,
    });
    const pastArrival = new Date("2026-09-02T15:00:00.000Z");
    const futureArrival = new Date("2026-09-02T18:00:00.000Z");
    const nearA = northOf(pointA, 1609.344);
    const nearer = northOf(pointA, 2000);
    let now = new Date("2026-09-01T00:00:00.000Z");
    const calls: { latitude: number; longitude: number }[] = [];

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id, pointA);
      const deps: ScheduleDeps = {
        now: () => now,
        lookupAddress: async () => "Driver location",
        driveDuration: async (origin, destination) => {
          calls.push({ latitude: origin.latitude, longitude: origin.longitude });
          if (destination.latitude === pointC.latitude && origin.latitude === pointA.latitude) {
            return 1200;
          }
          if (destination.latitude === pointC.latitude && origin.latitude === nearA.latitude) {
            return 900;
          }
          if (destination.latitude === pointC.latitude && origin.latitude === nearer.latitude) {
            return 60;
          }
          return 0;
        },
      };
      const past = await authorSortie(
        person.user,
        {
          label: "Past",
          arrivalAt: pastArrival,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointA, "A", true)],
        },
        deps,
      );
      assert.equal(typeof past, "object");
      if (typeof past !== "object") {
        return;
      }

      const future = await authorSortie(
        person.user,
        {
          label: "Future",
          arrivalAt: futureArrival,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointC, "C", true)],
        },
        deps,
      );
      assert.equal(typeof future, "object");
      if (typeof future !== "object") {
        return;
      }
      assert.equal(future.scheduledStart, new Date(futureArrival.getTime() - 1200 * 1000).toISOString());
      assert.equal(future.departureAddress, "A");

      now = new Date("2026-09-02T16:00:00.000Z");
      calls.length = 0;
      const moved = await recordObservation(
        person.user,
        {
          observedAt: now,
          latitude: nearA.latitude,
          longitude: nearA.longitude,
          accuracyMeters: 10,
        },
        deps,
      );
      assert.equal(moved, "ok");
      const recomputed = await db
        .select({
          scheduledStart: sortie.scheduledStart,
          latitude: sortie.scheduleOriginLatitude,
          longitude: sortie.scheduleOriginLongitude,
        })
        .from(sortie)
        .where(eq(sortie.id, future.id));
      assert.equal(
        recomputed[0]?.scheduledStart.toISOString(),
        new Date(futureArrival.getTime() - 900 * 1000).toISOString(),
      );
      assert.equal(recomputed[0]?.latitude, nearA.latitude);
      assert.equal(recomputed[0]?.longitude, nearA.longitude);
      assert.equal(await shownDeparture(person.user, future.id, deps), "Driver location");
      assert.ok(calls.some((call) => call.latitude === nearA.latitude));

      calls.length = 0;
      const held = await recordObservation(
        person.user,
        {
          observedAt: new Date("2026-09-02T16:05:00.000Z"),
          latitude: nearer.latitude,
          longitude: nearer.longitude,
          accuracyMeters: 10,
        },
        deps,
      );
      assert.equal(held, "ok");
      assert.equal(calls.length, 0);
      const kept = await db
        .select({ scheduledStart: sortie.scheduledStart, latitude: sortie.scheduleOriginLatitude })
        .from(sortie)
        .where(eq(sortie.id, future.id));
      assert.equal(kept[0]?.scheduledStart.toISOString(), new Date(futureArrival.getTime() - 900 * 1000).toISOString());
      assert.equal(kept[0]?.latitude, nearA.latitude);
    } finally {
      await removeUser(person.user.id);
    }
  });
  it("keeps the next drive on an in-progress terminal after the scheduled end passes", async () => {
    const person = await createSession({
      sub: `calendar-in-progress-origin-${crypto.randomUUID()}`,
      displayName: "In progress origin",
      email: null,
    });
    const airportArrival = new Date("2026-10-14T15:30:00.000Z");
    const upcomingArrival = new Date("2026-10-14T18:00:00.000Z");
    const midRoute = northOf(pointA, 2 * 1609.344);
    const airportFix = northOf(pointA, 200);
    let now = new Date("2026-10-14T15:00:00.000Z");
    const calls: { latitude: number; longitude: number }[] = [];

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id, pointB);
      const deps: ScheduleDeps = {
        now: () => now,
        lookupAddress: async (origin) => {
          if (origin.latitude === midRoute.latitude) {
            return "2612 Castle Hayne Rd";
          }
          if (origin.latitude === airportFix.latitude) {
            return "1740 Airport Blvd";
          }
          return "Driver location";
        },
        driveDuration: async (origin) => {
          calls.push({ latitude: origin.latitude, longitude: origin.longitude });
          return 600;
        },
      };

      const upcoming = await authorSortie(
        person.user,
        {
          label: "Oil Change",
          arrivalAt: upcomingArrival,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointC, "South 17th Street", false)],
        },
        deps,
      );
      assert.equal(typeof upcoming, "object");
      if (typeof upcoming !== "object") {
        return;
      }

      const airport = await authorSortie(
        person.user,
        {
          label: "ILM",
          arrivalAt: airportArrival,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointA, "Airport Boulevard", false)],
        },
        deps,
      );
      assert.equal(typeof airport, "object");
      if (typeof airport !== "object") {
        return;
      }
      const chained = await db
        .select({ latitude: sortie.scheduleOriginLatitude })
        .from(sortie)
        .where(eq(sortie.id, upcoming.id));
      assert.equal(await shownDeparture(person.user, upcoming.id, deps), "Airport Boulevard");
      assert.equal(chained[0]?.latitude, pointA.latitude);

      const commenced = await commenceSortie(person.user, airport.id, deps);
      assert.equal(typeof commenced, "object");
      if (typeof commenced !== "object" || commenced.scheduledEnd === undefined) {
        return;
      }

      now = new Date(Date.parse(commenced.scheduledEnd) + 2_000);
      calls.length = 0;
      const enRoute = await recordObservation(
        person.user,
        {
          observedAt: now,
          latitude: midRoute.latitude,
          longitude: midRoute.longitude,
          accuracyMeters: 8,
        },
        deps,
      );
      assert.equal(enRoute, "ok");
      const held = await db
        .select({
          latitude: sortie.scheduleOriginLatitude,
          longitude: sortie.scheduleOriginLongitude,
        })
        .from(sortie)
        .where(eq(sortie.id, upcoming.id));
      assert.equal(await shownDeparture(person.user, upcoming.id, deps), "Airport Boulevard");
      assert.equal(held[0]?.latitude, pointA.latitude);
      assert.equal(held[0]?.longitude, pointA.longitude);
      assert.equal(
        calls.some((call) => call.latitude === midRoute.latitude),
        false,
      );

      const completed = await completeSortie(person.user, airport.id, deps);
      assert.equal(typeof completed, "object");
      await db
        .update(sortie)
        .set({
          scheduleOriginLatitude: midRoute.latitude,
          scheduleOriginLongitude: midRoute.longitude,
        })
        .where(eq(sortie.id, upcoming.id));

      calls.length = 0;
      const atTerminal = await recordObservation(
        person.user,
        {
          observedAt: new Date(now.getTime() + 60_000),
          latitude: airportFix.latitude,
          longitude: airportFix.longitude,
          accuracyMeters: 8,
        },
        deps,
      );
      assert.equal(atTerminal, "ok");
      const healed = await db
        .select({
          latitude: sortie.scheduleOriginLatitude,
          longitude: sortie.scheduleOriginLongitude,
        })
        .from(sortie)
        .where(eq(sortie.id, upcoming.id));
      assert.equal(await shownDeparture(person.user, upcoming.id, deps), "1740 Airport Blvd");
      assert.equal(healed[0]?.latitude, airportFix.latitude);
      assert.equal(healed[0]?.longitude, airportFix.longitude);
      assert.ok(calls.some((call) => call.latitude === airportFix.latitude && call.longitude === airportFix.longitude));
    } finally {
      await removeUser(person.user.id);
    }
  });
  it("does not leave the next drive at an older unfinished stop after a later sortie is completed", async () => {
    const person = await createSession({
      sub: `calendar-abandoned-origin-${crypto.randomUUID()}`,
      displayName: "Abandoned origin",
      email: null,
    });
    const abandonedArrival = new Date("2026-10-13T21:30:00.000Z");
    const airportArrival = new Date("2026-10-14T15:30:00.000Z");
    const upcomingArrival = new Date("2026-10-14T18:00:00.000Z");
    let now = new Date("2026-10-13T21:00:00.000Z");

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id, pointB);
      const deps: ScheduleDeps = {
        now: () => now,
        lookupAddress: async () => "1740 Airport Blvd",
        driveDuration: async () => 600,
      };

      const abandoned = await authorSortie(
        person.user,
        {
          label: "Yesterday",
          arrivalAt: abandonedArrival,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointD, "Castle Hayne Road", false)],
        },
        deps,
      );
      assert.equal(typeof abandoned, "object");
      if (typeof abandoned !== "object") {
        return;
      }
      const commencedAbandoned = await commenceSortie(person.user, abandoned.id, deps);
      assert.equal(typeof commencedAbandoned, "object");

      now = new Date("2026-10-14T15:00:00.000Z");
      const upcoming = await authorSortie(
        person.user,
        {
          label: "Oil Change",
          arrivalAt: upcomingArrival,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointC, "South 17th Street", false)],
        },
        deps,
      );
      assert.equal(typeof upcoming, "object");
      if (typeof upcoming !== "object") {
        return;
      }

      const airport = await authorSortie(
        person.user,
        {
          label: "ILM",
          arrivalAt: airportArrival,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(pointA, "Airport Boulevard", false)],
        },
        deps,
      );
      assert.equal(typeof airport, "object");
      if (typeof airport !== "object") {
        return;
      }
      const commencedAirport = await commenceSortie(person.user, airport.id, deps);
      assert.equal(typeof commencedAirport, "object");
      if (typeof commencedAirport !== "object") {
        return;
      }
      now = new Date(Date.parse(commencedAirport.scheduledEnd) + 60_000);
      const completed = await completeSortie(person.user, airport.id, deps);
      assert.equal(typeof completed, "object");

      const atAirport = await recordObservation(
        person.user,
        {
          observedAt: now,
          latitude: pointA.latitude,
          longitude: pointA.longitude,
          accuracyMeters: 8,
        },
        deps,
      );
      assert.equal(atAirport, "ok");
      const origin = await db
        .select({ latitude: sortie.scheduleOriginLatitude })
        .from(sortie)
        .where(eq(sortie.id, upcoming.id));
      const departedFrom = await shownDeparture(person.user, upcoming.id, deps);
      assert.notEqual(departedFrom, "Castle Hayne Road");
      assert.equal(origin[0]?.latitude, pointA.latitude);
      assert.equal(departedFrom, "1740 Airport Blvd");
    } finally {
      await removeUser(person.user.id);
    }
  });
  it("replaces a stale origin once the driver is at the next stop", async () => {
    const person = await createSession({
      sub: `calendar-at-pickup-${crypto.randomUUID()}`,
      displayName: "At pickup",
      email: null,
    });
    const hall = { latitude: 34.274802, longitude: -77.9182343 };
    const airportFix = { latitude: 34.267558, longitude: -77.912007 };
    const ilm = { latitude: 34.267045, longitude: -77.910467 };
    const arrival = new Date("2026-10-15T21:55:00.000Z");
    const now = new Date("2026-10-15T21:20:00.000Z");

    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id, hall);
      const deps: ScheduleDeps = {
        now: () => now,
        lookupAddress: async (origin) =>
          origin.latitude === airportFix.latitude ? "1740 Airport Blvd" : "1700 Hall Dr",
        driveDuration: async () => 600,
      };
      const upcoming = await authorSortie(
        person.user,
        {
          label: "AA2826",
          arrivalAt: arrival,
          passengerName: null,
          passengerPhone: null,
          stops: [lineStop(ilm, "Airport Boulevard", false)],
        },
        deps,
      );
      assert.equal(typeof upcoming, "object");
      if (typeof upcoming !== "object") {
        return;
      }
      await db
        .update(sortie)
        .set({
          scheduleOriginLatitude: hall.latitude,
          scheduleOriginLongitude: hall.longitude,
        })
        .where(eq(sortie.id, upcoming.id));

      const observed = await recordObservation(
        person.user,
        {
          observedAt: now,
          latitude: airportFix.latitude,
          longitude: airportFix.longitude,
          accuracyMeters: 8,
        },
        deps,
      );
      assert.equal(observed, "ok");
      const origin = await db
        .select({ latitude: sortie.scheduleOriginLatitude })
        .from(sortie)
        .where(eq(sortie.id, upcoming.id));
      assert.equal(await shownDeparture(person.user, upcoming.id, deps), "1740 Airport Blvd");
      assert.equal(origin[0]?.latitude, airportFix.latitude);
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
  it("recomputes a future C-to-D start when the vehicle moves to A and then B", async () => {
    const person = await createSession({
      sub: `calendar-line-cdb-${crypto.randomUUID()}`,
      displayName: "Line CDB",
      email: null,
    });
    const calls: DriveCall[] = [];
    const startAtC = new Date(lineT.getTime() - hopSeconds * 1000).toISOString();
    const startAtA = new Date(lineT.getTime() - 3 * hopSeconds * 1000).toISOString();
    const startAtB = new Date(lineT.getTime() - 2 * hopSeconds * 1000).toISOString();

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
      assert.equal(authored.scheduledStart, startAtC);

      const movedToA = await recordObservation(
        person.user,
        {
          observedAt: new Date("2026-09-01T13:00:00.000Z"),
          latitude: pointA.latitude,
          longitude: pointA.longitude,
          accuracyMeters: 10,
        },
        deps,
      );
      assert.equal(movedToA, "ok");
      const atA = await readCalendar(person.user, scheduleNow, new Date("2026-10-01T00:00:00.000Z"));
      assert.equal(Array.isArray(atA), true);
      if (!Array.isArray(atA)) {
        return;
      }
      assert.equal(atA[0]?.scheduledStart, startAtA);
      assert.ok(Date.parse(startAtA) < Date.parse(startAtC));

      const movedToB = await recordObservation(
        person.user,
        {
          observedAt: new Date("2026-09-01T14:00:00.000Z"),
          latitude: pointB.latitude,
          longitude: pointB.longitude,
          accuracyMeters: 10,
        },
        deps,
      );
      assert.equal(movedToB, "ok");
      const atB = await readCalendar(person.user, scheduleNow, new Date("2026-10-01T00:00:00.000Z"));
      assert.equal(Array.isArray(atB), true);
      if (!Array.isArray(atB)) {
        return;
      }
      assert.equal(atB[0]?.scheduledStart, startAtB);
      assert.equal(Date.parse(startAtB) - Date.parse(startAtA), hopSeconds * 1000);
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

      const calendar = await readCalendar(person.user, scheduleNow, new Date("2026-10-01T00:00:00.000Z"), deps);
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
