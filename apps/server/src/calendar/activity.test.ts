import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { RealtimeEnvelope } from "@groundops/contracts";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { closeDatabase, db } from "../db.js";
import { migrateDatabase } from "../migrate.js";
import { createSession } from "../identity/sessions.js";
import { withRealtimePublisher } from "../realtime.js";
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
import {
  authorSortie,
  commenceSortie,
  completeSortie,
  ensureDriver,
  readActivity,
  recordObservation,
  type ScheduleDeps,
  type SortieInput,
} from "./calendar.js";
import { registerCalendarRoutes } from "./http.js";
import { replaceMeterReading } from "./meterReading.js";

const scheduleDeps: ScheduleDeps = {
  now: () => new Date("2026-09-01T12:00:00.000Z"),
  driveDuration: async () => 600,
  lookupAddress: async () => "Observed address",
};

const originStop = {
  label: "Origin",
  latitude: 40.7128,
  longitude: -74.006,
  waitMinutes: 0,
  passenger: true,
};

before(async () => {
  await migrateDatabase();
});

after(async () => {
  await closeDatabase();
});

describe("account broadcast", () => {
  it("publishes a sortie after commit and publishes nothing when the write is rejected", async () => {
    const person = await createSession({
      sub: `live-${crypto.randomUUID()}`,
      displayName: "Live Driver",
      email: "live@example.com",
    });
    const events: RealtimeEnvelope[] = [];
    try {
      await ensureDriver(person.user);
      await placeDriver(person.user.id);
      await withRealtimePublisher(
        (envelope) => {
          events.push(envelope);
        },
        async () => {
          const rejected = await authorSortie(
            person.user,
            { label: "Nope", arrivalAt: null, passengerName: null, passengerPhone: null, stops: [] },
            scheduleDeps,
          );
          assert.equal(rejected, "invalid");
          assert.equal(events.length, 0);

          const authored = await authorSortie(person.user, task("Crew move"), scheduleDeps);
          assert.equal(typeof authored, "object");
          assert.equal(events.some((event) => event.type === "sortie.updated" && event.userId === person.user.id), true);

          const observed = await recordObservation(
            person.user,
            {
              observedAt: new Date("2026-09-01T12:05:00.000Z"),
              latitude: 40.1,
              longitude: -74.1,
              accuracyMeters: 8,
            },
            scheduleDeps,
          );
          assert.equal(observed, "ok");
          const location = events.find((event) => event.type === "location.updated");
          assert.equal(location?.type, "location.updated");
          if (location?.type === "location.updated") {
            assert.equal(location.location.latitude, 40.1);
            assert.equal(location.userId, person.user.id);
          }

          const before = events.length;
          const invalidFix = await recordObservation(
            person.user,
            {
              observedAt: new Date("not-a-date"),
              latitude: 1,
              longitude: 1,
              accuracyMeters: null,
            },
            scheduleDeps,
          );
          assert.equal(invalidFix, "invalid");
          assert.equal(events.length, before);
        },
      );
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("stores a meter for the in-progress sortie and hides it from another user", async () => {
    const driverSession = await createSession({
      sub: `meter-${crypto.randomUUID()}`,
      displayName: "Meter Driver",
      email: "meter@example.com",
    });
    const other = await createSession({
      sub: `other-${crypto.randomUUID()}`,
      displayName: "Other",
      email: "other@example.com",
    });
    const events: RealtimeEnvelope[] = [];
    try {
      await ensureDriver(driverSession.user);
      await placeDriver(driverSession.user.id);
      await ensureDriver(other.user);
      const authored = await authorSortie(driverSession.user, task("Fare"), scheduleDeps);
      assert.equal(typeof authored, "object");
      if (typeof authored !== "object") {
        return;
      }
      const commenced = await commenceSortie(driverSession.user, authored.id, scheduleDeps);
      assert.equal(typeof commenced, "object");
      if (typeof commenced !== "object") {
        return;
      }

      const path = [
        { latitude: 40, longitude: -74 },
        { latitude: 40.7, longitude: -74 },
      ];
      await withRealtimePublisher(
        (envelope) => {
          events.push(envelope);
        },
        async () => {
          const denied = await replaceMeterReading(other.user, reading(commenced.id, path));
          assert.equal(denied, "not-in-progress");

          const saved = await replaceMeterReading(driverSession.user, reading(commenced.id, path));
          assert.equal(typeof saved, "object");
          const kept = await replaceMeterReading(driverSession.user, {
            sortieId: commenced.id,
            milesTraveled: 1.5,
            waitSeconds: 30,
            totalCents: 425,
            estimateCents: 900,
            remainingMeters: 1200,
          });
          assert.equal(typeof kept, "object");
          if (typeof kept === "object") {
            assert.equal(kept.milesTraveled, 1.5);
            assert.deepEqual(kept.overviewPath, path);
          }

          const activity = await readActivity(driverSession.user);
          assert.equal(activity.sortie?.id, commenced.id);
          assert.equal(activity.meter?.milesTraveled, 1.5);
          assert.equal(activity.location?.latitude, 40);

          const otherActivity = await readActivity(other.user);
          assert.equal(otherActivity.sortie, null);
          assert.equal(otherActivity.meter, null);

          const completed = await completeSortie(driverSession.user, commenced.id, scheduleDeps);
          assert.equal(typeof completed, "object");
          const after = await readActivity(driverSession.user);
          assert.equal(after.meter, null);
          assert.equal(after.sortie, null);
          assert.equal(events.some((event) => event.type === "meter.cleared" && event.userId === driverSession.user.id), true);
        },
      );
    } finally {
      await removeUser(driverSession.user.id);
      await removeUser(other.user.id);
    }
  });

  it("rejects a meter write and an activity read without a session", async () => {
    const app = Fastify();
    registerCalendarRoutes(app, scheduleDeps);
    const meter = await app.inject({ method: "PUT", url: "/meter-reading", payload: reading(crypto.randomUUID(), []) });
    assert.equal(meter.statusCode, 401);
    const activity = await app.inject({ method: "GET", url: "/activity" });
    assert.equal(activity.statusCode, 401);
    await app.close();
  });
});

function task(label: string): SortieInput {
  return {
    label,
    arrivalAt: new Date("2026-09-02T15:00:00.000Z"),
    passengerName: null,
    passengerPhone: null,
    stops: [originStop],
  };
}

function reading(sortieId: string, overviewPath: { latitude: number; longitude: number }[]) {
  return {
    sortieId,
    milesTraveled: 0.5,
    waitSeconds: 30,
    totalCents: 425,
    estimateCents: 900,
    remainingMeters: 1200,
    overviewPath,
  };
}

async function placeDriver(userId: string): Promise<void> {
  const rows = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  const row = rows[0];
  if (!row) {
    throw new Error("driver missing");
  }
  await db.insert(locationObservation).values({
    driverId: row.id,
    observedAt: new Date("2026-09-01T12:00:00.000Z"),
    latitude: 40,
    longitude: -74,
    accuracyMeters: 8,
  });
}

async function removeUser(userId: string): Promise<void> {
  const drivers = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  for (const row of drivers) {
    await db.delete(driverMeterReading).where(eq(driverMeterReading.driverId, row.id));
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
