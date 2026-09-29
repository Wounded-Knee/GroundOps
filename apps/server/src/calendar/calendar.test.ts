import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { closeDatabase, db } from "../db.js";
import { migrateDatabase } from "../migrate.js";
import { createSession } from "../identity/sessions.js";
import { company, driver, driverCompany, operationalEvent, session, sortie, sortieStop, user, userCredential } from "../schema.js";
import { authorSortie, ensureDriver, readCalendar, reviseSortie, type SortieInput } from "./calendar.js";
import { registerCalendarRoutes } from "./http.js";

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
      await ensureDriver(second.user);
      assert.notEqual((await ensureDriver(second.user)).id, (await ensureDriver(first.user)).id);

      const from = new Date("2026-09-01T00:00:00.000Z");
      const to = new Date("2026-10-01T00:00:00.000Z");
      const authored = await authorSortie(
        first.user,
        task("  Crew move  ", new Date("2026-09-02T15:00:00.000Z"), new Date("2026-09-02T16:00:00.000Z")),
      );
      assert.equal(authored !== "no-driver" && authored !== "invalid", true);
      if (authored === "no-driver" || authored === "invalid") {
        return;
      }
      assert.equal(authored.type, "task");
      assert.equal(authored.label, "Crew move");

      const earlier = await authorSortie(
        first.user,
        task("Earlier", new Date("2026-09-02T13:00:00.000Z"), new Date("2026-09-02T14:00:00.000Z")),
      );
      assert.equal(earlier !== "no-driver" && earlier !== "invalid", true);

      const outside = await authorSortie(
        first.user,
        task("Outside", new Date("2026-10-01T00:00:00.000Z"), new Date("2026-10-01T01:00:00.000Z")),
      );
      assert.equal(outside !== "no-driver" && outside !== "invalid", true);

      const touching = await authorSortie(
        first.user,
        task("Touching", new Date("2026-08-31T23:00:00.000Z"), new Date("2026-09-01T00:00:00.000Z")),
      );
      assert.equal(touching !== "no-driver" && touching !== "invalid", true);

      const calendar = await readCalendar(first.user, from, to);
      assert.equal(Array.isArray(calendar), true);
      if (!Array.isArray(calendar) || earlier === "no-driver" || earlier === "invalid") {
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
        ["sortie.created"],
      );
      assert.equal(createdEvents[0]?.label, "Crew move");
    } finally {
      await removeUser(first.user.id);
      await removeUser(second.user.id);
    }
  });

  it("revises a sortie and appends one event, and rejects an empty or inverted interval", async () => {
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
      await ensureDriver(other.user);
      const authored = await authorSortie(
        person.user,
        task("Original", new Date("2026-09-03T15:00:00.000Z"), new Date("2026-09-03T16:00:00.000Z")),
      );
      assert.equal(typeof authored === "object", true);
      if (typeof authored !== "object") {
        return;
      }

      const empty = await authorSortie(
        person.user,
        task("   ", new Date("2026-09-03T15:00:00.000Z"), new Date("2026-09-03T16:00:00.000Z")),
      );
      const inverted = await reviseSortie(
        person.user,
        authored.id,
        task("Nope", new Date("2026-09-03T16:00:00.000Z"), new Date("2026-09-03T16:00:00.000Z")),
      );
      assert.equal(empty, "invalid");
      assert.equal(inverted, "invalid");
      assert.equal((await eventsFor(authored.id)).length, 1);

      const revised = await reviseSortie(
        person.user,
        authored.id,
        task("Updated", new Date("2026-09-04T15:00:00.000Z"), new Date("2026-09-04T17:00:00.000Z")),
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
        task("Stolen", new Date("2026-09-04T15:00:00.000Z"), new Date("2026-09-04T17:00:00.000Z")),
      );
      assert.equal(stolen, "not-found");
      assert.equal((await eventsFor(authored.id)).length, 2);

      const missing = await reviseSortie(
        person.user,
        crypto.randomUUID(),
        task("Missing", new Date("2026-09-04T15:00:00.000Z"), new Date("2026-09-04T17:00:00.000Z")),
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
        task("Early", new Date("2026-09-02T15:00:00.000Z"), new Date("2026-09-02T16:00:00.000Z")),
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
    registerCalendarRoutes(app);

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
      const created = await app.inject({
        method: "POST",
        url: "/sorties",
        headers: { authorization: `Bearer ${person.token}` },
        payload: taskJson("Http sortie", "2026-09-08T12:00:00.000Z", "2026-09-08T13:00:00.000Z"),
      });
      assert.equal(created.statusCode, 201);
      const sortieId = created.json().id as string;

      const blank = await app.inject({
        method: "POST",
        url: "/sorties",
        headers: { authorization: `Bearer ${person.token}` },
        payload: taskJson(" ", "2026-09-08T12:00:00.000Z", "2026-09-08T13:00:00.000Z"),
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
        payload: taskJson("Http revised", "2026-09-09T12:00:00.000Z", "2026-09-09T13:00:00.000Z"),
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
      const badPhone = await authorSortie(
        person.user,
        task("Phone", new Date("2026-09-05T15:00:00.000Z"), new Date("2026-09-05T16:00:00.000Z"), {
          passengerPhone: "555",
        }),
      );
      const oneStop = await authorSortie(
        person.user,
        task("One", new Date("2026-09-05T15:00:00.000Z"), new Date("2026-09-05T16:00:00.000Z"), {
          stops: [originStop],
        }),
      );
      assert.equal(badPhone, "invalid");
      assert.equal(oneStop, "invalid");

      const authored = await authorSortie(
        person.user,
        task("Passenger", new Date("2026-09-05T15:00:00.000Z"), new Date("2026-09-05T16:00:00.000Z"), {
          passengerName: "  Ada  ",
          passengerPhone: "5551234567",
          stops: [originStop, waypointStop, destinationStop],
        }),
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
      assert.deepEqual(
        calendar[0]?.stops.map((stop) => stop.label),
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
        task("Passenger", new Date("2026-09-06T15:00:00.000Z"), new Date("2026-09-06T16:00:00.000Z"), {
          passengerName: "Ada",
          passengerPhone: "5551234567",
          stops: [originStop, destinationStop],
        }),
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

const originStop = { label: "Origin", latitude: 40.7128, longitude: -74.006 };
const destinationStop = { label: "Destination", latitude: 40.758, longitude: -73.9855 };
const waypointStop = { label: "Waypoint", latitude: 40.73, longitude: -73.99 };

function task(
  label: string,
  scheduledStart: Date,
  scheduledEnd: Date,
  extra?: Partial<SortieInput>,
): SortieInput {
  return {
    label,
    scheduledStart,
    scheduledEnd,
    passengerName: null,
    passengerPhone: null,
    stops: [originStop, destinationStop],
    ...extra,
  };
}

function taskJson(label: string, scheduledStart: string, scheduledEnd: string) {
  return {
    label,
    scheduledStart,
    scheduledEnd,
    passengerName: null,
    passengerPhone: null,
    stops: [originStop, destinationStop],
  };
}

async function removeUser(userId: string): Promise<void> {
  const drivers = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  for (const row of drivers) {
    const sorties = await db.select({ id: sortie.id }).from(sortie).where(eq(sortie.authorDriverId, row.id));
    for (const item of sorties) {
      await db.delete(operationalEvent).where(eq(operationalEvent.sortieId, item.id));
      await db.delete(sortieStop).where(eq(sortieStop.sortieId, item.id));
    }
    await db.delete(sortie).where(eq(sortie.authorDriverId, row.id));
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
