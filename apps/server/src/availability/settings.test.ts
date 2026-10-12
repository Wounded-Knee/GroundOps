import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { defaultAvailabilitySettings, type GeoCoordinate } from "@groundops/contracts";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { registerCalendarRoutes } from "../calendar/http.js";
import type { ScheduleDeps } from "../calendar/calendar.js";
import { closeDatabase, db } from "../db.js";
import { createSession } from "../identity/sessions.js";
import { migrateDatabase } from "../migrate.js";
import {
  company,
  driver,
  driverAvailabilityEvent,
  driverCompany,
  locationObservation,
  session,
  sortie,
  user,
  userCredential,
} from "../schema.js";
import { applyAutomaticAvailability, applyAutomaticAvailabilityLead } from "./automatic.js";
import { registerAvailabilityRoutes } from "./http.js";

const now = new Date("2026-10-12T15:00:00.000Z");
const square: GeoCoordinate[] = [
  { latitude: 0, longitude: 0 },
  { latitude: 0, longitude: 1 },
  { latitude: 1, longitude: 1 },
  { latitude: 1, longitude: 0 },
];

const scheduleDeps: ScheduleDeps = {
  now: () => now,
  driveDuration: async () => 60,
  lookupAddress: async () => null,
};

describe("availability settings", () => {
  let app: FastifyInstance;

  before(async () => {
    await migrateDatabase();
    app = Fastify();
    currentApp = () => app;
    registerAvailabilityRoutes(app, { now: () => now });
    registerCalendarRoutes(app, scheduleDeps);
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it("rejects a missing session and an invalid body", async () => {
    const missing = await app.inject({ method: "GET", url: "/availability/settings" });
    assert.equal(missing.statusCode, 401);
    const person = await createSession({
      sub: `availability-settings-auth-${crypto.randomUUID()}`,
      displayName: "Auth",
      email: null,
    });
    try {
      const header = { authorization: `Bearer ${person.token}` };
      const threshold = await app.inject({
        method: "PUT",
        url: "/availability/settings",
        headers: header,
        payload: { ...defaultAvailabilitySettings, thresholdMinutes: 121 },
      });
      assert.equal(threshold.statusCode, 400);
      const fraction = await app.inject({
        method: "PUT",
        url: "/availability/settings",
        headers: header,
        payload: { ...defaultAvailabilitySettings, thresholdMinutes: 15.5 },
      });
      assert.equal(fraction.statusCode, 400);
      const shortRing = await app.inject({
        method: "PUT",
        url: "/availability/settings",
        headers: header,
        payload: { ...defaultAvailabilitySettings, geofence: square.slice(0, 2) },
      });
      assert.equal(shortRing.statusCode, 400);
      const onePoint = await app.inject({
        method: "PUT",
        url: "/availability/settings",
        headers: header,
        payload: { ...defaultAvailabilitySettings, geofence: square.slice(0, 1) },
      });
      assert.equal(onePoint.statusCode, 400);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("returns defaults and keeps one driver's geofence", async () => {
    const person = await createSession({
      sub: `availability-settings-own-${crypto.randomUUID()}`,
      displayName: "Own",
      email: null,
    });
    const other = await createSession({
      sub: `availability-settings-other-${crypto.randomUUID()}`,
      displayName: "Other",
      email: null,
    });
    try {
      const initial = await app.inject({
        method: "GET",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
      });
      assert.equal(initial.statusCode, 200);
      assert.deepEqual(initial.json(), defaultAvailabilitySettings);

      const saved = await app.inject({
        method: "PUT",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { ...defaultAvailabilitySettings, geofence: square, thresholdMinutes: 20 },
      });
      assert.equal(saved.statusCode, 200);
      assert.deepEqual(saved.json(), { ...defaultAvailabilitySettings, geofence: square, thresholdMinutes: 20 });

      const again = await app.inject({
        method: "GET",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
      });
      assert.deepEqual(again.json().geofence, square);

      const theirs = await app.inject({
        method: "GET",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${other.token}` },
      });
      assert.deepEqual(theirs.json(), defaultAvailabilitySettings);
    } finally {
      await removeUser(person.user.id);
      await removeUser(other.user.id);
    }
  });

  it("does not set a new driver available until a sortie concludes", async () => {
    const person = await createSession({
      sub: `availability-settings-sweep-${crypto.randomUUID()}`,
      displayName: "Sweep",
      email: null,
    });
    try {
      const created = await app.inject({
        method: "GET",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
      });
      assert.equal(created.statusCode, 200);
      assert.equal((await readChoice(person.token)).available, false);

      await applyAutomaticAvailabilityLead(now);
      assert.equal((await readChoice(person.token)).available, false);
      assert.equal((await eventsFor(person.user.id)).length, 0);

      await applyAutomaticAvailability(person.user, "conclusion", now);
      const after = await readChoice(person.token);
      assert.equal(after.available, true);
      assert.equal(after.current, true);
      await applyAutomaticAvailability(person.user, "conclusion", now);
      assert.equal((await eventsFor(person.user.id)).length, 1);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("leaves a sortie in progress unchanged and sets available when it concludes", async () => {
    const person = await createSession({
      sub: `availability-settings-progress-${crypto.randomUUID()}`,
      displayName: "Progress",
      email: null,
    });
    try {
      await app.inject({
        method: "GET",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
      });
      await app.inject({
        method: "PUT",
        url: "/availability",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { available: false },
      });
      await insertSortie(person.user.id, { actualStart: now, actualEnd: null, scheduledStart: later(60) });
      await applyAutomaticAvailability(person.user, "lead", now);
      assert.equal((await readChoice(person.token)).available, false);
      assert.equal((await eventsFor(person.user.id)).length, 0);

      await applyAutomaticAvailability(person.user, "commencement", now);
      assert.equal((await readChoice(person.token)).available, true);
      await applyAutomaticAvailability(person.user, "commencement", now);
      assert.equal((await eventsFor(person.user.id)).length, 1);

      await app.inject({
        method: "PUT",
        url: "/availability",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { available: false },
      });
      await applyAutomaticAvailability(person.user, "conclusion", now);
      assert.equal((await readChoice(person.token)).available, true);
      await applyAutomaticAvailability(person.user, "conclusion", now);
      assert.equal((await eventsFor(person.user.id)).length, 3);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("sets unavailable inside the lead and ignores an exact or overdue start", async () => {
    const person = await createSession({
      sub: `availability-settings-soon-${crypto.randomUUID()}`,
      displayName: "Soon",
      email: null,
    });
    try {
      await app.inject({
        method: "GET",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
      });
      await app.inject({
        method: "PUT",
        url: "/availability",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { available: true },
      });
      const sortieId = await insertSortie(person.user.id, {
        actualStart: null,
        actualEnd: null,
        scheduledStart: later(14),
      });
      await applyAutomaticAvailabilityLead(now);
      assert.equal((await readChoice(person.token)).available, false);

      await db.update(sortie).set({ scheduledStart: later(15) }).where(eq(sortie.id, sortieId));
      await applyAutomaticAvailabilityLead(now);
      assert.equal((await readChoice(person.token)).available, false);

      await db.update(sortie).set({ scheduledStart: later(-1) }).where(eq(sortie.id, sortieId));
      await applyAutomaticAvailabilityLead(now);
      assert.equal((await readChoice(person.token)).available, false);
      assert.equal((await eventsFor(person.user.id)).length, 2);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("does not change availability from a GPS fix", async () => {
    const person = await createSession({
      sub: `availability-settings-fence-${crypto.randomUUID()}`,
      displayName: "Fence",
      email: null,
    });
    try {
      await app.inject({
        method: "GET",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
      });
      await app.inject({
        method: "PUT",
        url: "/availability",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { available: true },
      });
      const saved = await app.inject({
        method: "PUT",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { ...defaultAvailabilitySettings, geofence: square },
      });
      assert.equal(saved.statusCode, 200);

      assert.equal(await observe(person.token, { latitude: 2, longitude: 2 }), 204);
      assert.equal((await readChoice(person.token)).available, true);
      assert.equal(await observe(person.token, { latitude: 0.5, longitude: 0.5 }), 204);
      assert.equal((await readChoice(person.token)).available, true);
      assert.equal((await eventsFor(person.user.id)).length, 1);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("skips a direction whose flag is off", async () => {
    const person = await createSession({
      sub: `availability-settings-flags-${crypto.randomUUID()}`,
      displayName: "Flags",
      email: null,
    });
    try {
      await app.inject({
        method: "GET",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
      });
      await app.inject({
        method: "PUT",
        url: "/availability",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { available: true },
      });
      const sortieId = await insertSortie(person.user.id, { actualStart: null, actualEnd: null, scheduledStart: later(14) });
      await app.inject({
        method: "PUT",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { ...defaultAvailabilitySettings, autoSetUnavailable: false },
      });
      await applyAutomaticAvailability(person.user, "lead", now);
      assert.equal((await readChoice(person.token)).available, true);

      await app.inject({
        method: "PUT",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
        payload: defaultAvailabilitySettings,
      });
      await applyAutomaticAvailability(person.user, "lead", now);
      assert.equal((await readChoice(person.token)).available, false);

      await db.update(sortie).set({ scheduledStart: later(60) }).where(eq(sortie.id, sortieId));
      await app.inject({
        method: "PUT",
        url: "/availability/settings",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { ...defaultAvailabilitySettings, autoSetAvailable: false },
      });
      await applyAutomaticAvailability(person.user, "conclusion", now);
      assert.equal((await readChoice(person.token)).available, false);
      assert.equal((await eventsFor(person.user.id)).length, 2);
    } finally {
      await removeUser(person.user.id);
    }
  });
});

function later(minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

let observationSequence = 0;

async function observe(token: string, point: GeoCoordinate): Promise<number> {
  observationSequence += 1;
  const response = await appInject("POST", "/location-observations", token, {
    observedAt: new Date(now.getTime() + observationSequence * 1000).toISOString(),
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyMeters: 5,
  });
  return response.statusCode;
}

async function readChoice(token: string): Promise<{ available: boolean; current: boolean }> {
  const response = await appInject("GET", "/availability", token);
  return response.json();
}

function appInject(method: "GET" | "PUT" | "POST", url: string, token: string, payload?: object) {
  const headers = { authorization: `Bearer ${token}` };
  if (payload === undefined) {
    return currentApp().inject({ method, url, headers });
  }
  return currentApp().inject({ method, url, headers, payload });
}

let currentApp = (): FastifyInstance => {
  throw new Error("app missing");
};

async function insertSortie(
  userId: string,
  fields: { actualStart: Date | null; actualEnd: Date | null; scheduledStart: Date },
): Promise<string> {
  const driverId = await driverFor(userId);
  const links = await db
    .select({ companyId: driverCompany.companyId })
    .from(driverCompany)
    .where(eq(driverCompany.driverId, driverId))
    .limit(1);
  const companyId = links[0]?.companyId;
  if (!companyId) {
    throw new Error("company missing");
  }
  const inserted = await db
    .insert(sortie)
    .values({
      companyId,
      authorDriverId: driverId,
      type: "task",
      label: "Trip",
      arrivalAt: fields.scheduledStart,
      scheduledStart: fields.scheduledStart,
      scheduledEnd: new Date(fields.scheduledStart.getTime() + 60 * 60_000),
      actualStart: fields.actualStart,
      actualEnd: fields.actualEnd,
    })
    .returning({ id: sortie.id });
  const row = inserted[0];
  if (!row) {
    throw new Error("sortie missing");
  }
  return row.id;
}

async function driverFor(userId: string): Promise<string> {
  const rows = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("driver missing");
  }
  return row.id;
}

async function eventsFor(userId: string): Promise<{ available: boolean }[]> {
  const driverId = await driverFor(userId);
  return db
    .select({ available: driverAvailabilityEvent.available })
    .from(driverAvailabilityEvent)
    .where(eq(driverAvailabilityEvent.driverId, driverId))
    .orderBy(driverAvailabilityEvent.recordedAt);
}

async function removeUser(userId: string): Promise<void> {
  const drivers = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  for (const row of drivers) {
    await db.delete(locationObservation).where(eq(locationObservation.driverId, row.id));
    await db.delete(sortie).where(eq(sortie.authorDriverId, row.id));
    await db.delete(driverAvailabilityEvent).where(eq(driverAvailabilityEvent.driverId, row.id));
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
