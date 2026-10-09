import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { defaultTariff } from "@groundops/contracts";
import { closeDatabase, db } from "../db.js";
import { migrateDatabase } from "../migrate.js";
import { createSession } from "../identity/sessions.js";
import {
  company,
  driver,
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
import { authorSortie, ensureDriver, type ScheduleDeps, type SortieInput } from "./calendar.js";
import { registerCalendarRoutes } from "./http.js";
import { computeSortieDrivingRoute } from "./sortieRoute.js";
import { readTariff, replaceTariff } from "./tariff.js";

const scheduleDeps: ScheduleDeps = {
  driveDuration: async () => 600,
  lookupAddress: async () => "Observed address",
  now: () => new Date("2026-09-08T10:00:00.000Z"),
};

const route = {
  distanceMeters: 1000,
  durationSeconds: 120,
  path: [
    { latitude: 40.7, longitude: -74.0 },
    { latitude: 40.71, longitude: -74.01 },
  ],
  steps: [
    {
      instruction: "Go",
      maneuver: "straight" as const,
      distanceMeters: 1000,
      durationSeconds: 120,
      path: [
        { latitude: 40.7, longitude: -74.0 },
        { latitude: 40.71, longitude: -74.01 },
      ],
    },
  ],
};

before(async () => {
  await migrateDatabase();
});

after(async () => {
  await closeDatabase();
});

describe("driver tariff", () => {
  it("returns defaults on first read and persists a replace", async () => {
    const person = await createSessionFor("tariff-a@example.com");
    await ensureDriver(person.user);
    const first = await readTariff(person.user);
    assert.deepEqual(first, defaultTariff);
    const saved = await replaceTariff(person.user, {
      flagCents: 500,
      perMileCents: 300,
      perWaitMinuteCents: 50,
    });
    assert.deepEqual(saved, {
      flagCents: 500,
      perMileCents: 300,
      perWaitMinuteCents: 50,
    });
    assert.deepEqual(await readTariff(person.user), saved);
    assert.equal(await replaceTariff(person.user, { flagCents: -1, perMileCents: 0, perWaitMinuteCents: 0 }), "invalid");
    await removeUser(person.user.id);
  });

  it("serves fare-rates over HTTP for the session owner", async () => {
    const person = await createSessionFor("tariff-http@example.com");
    await ensureDriver(person.user);
    const app = Fastify();
    registerCalendarRoutes(app, scheduleDeps, {
      computeDrivingRoute: async () => route,
    });
    await app.ready();
    const read = await app.inject({
      method: "GET",
      url: "/fare-rates",
      headers: { authorization: `Bearer ${person.token}` },
    });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json(), defaultTariff);
    const put = await app.inject({
      method: "PUT",
      url: "/fare-rates",
      headers: { authorization: `Bearer ${person.token}`, "content-type": "application/json" },
      payload: { flagCents: 100, perMileCents: 200, perWaitMinuteCents: 30 },
    });
    assert.equal(put.statusCode, 200);
    assert.deepEqual(put.json(), { flagCents: 100, perMileCents: 200, perWaitMinuteCents: 30 });
    const denied = await app.inject({ method: "GET", url: "/fare-rates" });
    assert.equal(denied.statusCode, 401);
    await app.close();
    await removeUser(person.user.id);
  });
});

describe("sortie driving route", () => {
  it("routes through remaining stops and rejects another driver's sortie", async () => {
    const owner = await createSessionFor("route-owner@example.com");
    const other = await createSessionFor("route-other@example.com");
    await seedObservation(owner.user.id, { latitude: 40.7, longitude: -74.0 });
    await ensureDriver(other.user);
    const authored = await authorSortie(owner.user, taskInput(), scheduleDeps);
    assert.ok(typeof authored !== "string");
    let intermediateCount = -1;
    const computed = await computeSortieDrivingRoute(
      owner.user,
      authored.id,
      { latitude: 40.7, longitude: -74.0 },
      0,
      {
        computeDrivingRoute: async (_origin, _destination, intermediates) => {
          intermediateCount = intermediates.length;
          return route;
        },
      },
    );
    assert.deepEqual(computed, route);
    assert.equal(intermediateCount, 2);
    const foreign = await computeSortieDrivingRoute(
      other.user,
      authored.id,
      { latitude: 40.7, longitude: -74.0 },
      0,
      { computeDrivingRoute: async () => route },
    );
    assert.equal(foreign, "not-found");
    await removeUser(owner.user.id);
    await removeUser(other.user.id);
  });

  it("serves the sortie route over HTTP", async () => {
    const person = await createSessionFor("route-http@example.com");
    await seedObservation(person.user.id, { latitude: 40.7, longitude: -74.0 });
    const authored = await authorSortie(person.user, taskInput(), scheduleDeps);
    assert.ok(typeof authored !== "string");
    const app = Fastify();
    registerCalendarRoutes(app, scheduleDeps, {
      computeDrivingRoute: async () => route,
    });
    await app.ready();
    const ok = await app.inject({
      method: "POST",
      url: `/sorties/${authored.id}/driving-route`,
      headers: { authorization: `Bearer ${person.token}`, "content-type": "application/json" },
      payload: { origin: { latitude: 40.7, longitude: -74.0 }, firstStopPosition: 0 },
    });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json().route, route);
    const bad = await app.inject({
      method: "POST",
      url: `/sorties/${authored.id}/driving-route`,
      headers: { authorization: `Bearer ${person.token}`, "content-type": "application/json" },
      payload: { origin: { latitude: 40.7, longitude: -74.0 }, firstStopPosition: 99 },
    });
    assert.equal(bad.statusCode, 400);
    await app.close();
    await removeUser(person.user.id);
  });
});

function taskInput(): SortieInput {
  return {
    label: "Airport",
    arrivalAt: new Date("2026-09-08T12:00:00.000Z"),
    passengerName: null,
    passengerPhone: null,
    stops: [
      { label: "Hotel", latitude: 40.71, longitude: -74.01, waitMinutes: 0, passenger: false },
      { label: "Mid", latitude: 40.715, longitude: -74.015, waitMinutes: 0, passenger: true },
      { label: "JFK", latitude: 40.64, longitude: -73.78, waitMinutes: 0, passenger: true },
    ],
  };
}

async function createSessionFor(email: string) {
  return createSession({
    sub: `google-${email}-${crypto.randomUUID()}`,
    displayName: email,
    email,
  });
}

async function seedObservation(userId: string, coordinate: { latitude: number; longitude: number }): Promise<void> {
  await ensureDriver({ id: userId, displayName: null, email: null });
  const rows = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId)).limit(1);
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
    await db.delete(driverMeterReading).where(eq(driverMeterReading.driverId, row.id));
    const sorties = await db.select({ id: sortie.id }).from(sortie).where(eq(sortie.authorDriverId, row.id));
    for (const item of sorties) {
      await db.delete(operationalEvent).where(eq(operationalEvent.sortieId, item.id));
      await db.delete(sortieStop).where(eq(sortieStop.sortieId, item.id));
    }
    await db.delete(sortie).where(eq(sortie.authorDriverId, row.id));
    await db.delete(locationObservation).where(eq(locationObservation.driverId, row.id));
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
