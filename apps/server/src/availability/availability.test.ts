import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { RealtimeEnvelope } from "@groundops/contracts";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { closeDatabase, db } from "../db.js";
import { createSession } from "../identity/sessions.js";
import { migrateDatabase } from "../migrate.js";
import { deleteDirectoryUser } from "../platform/directory.js";
import { withRealtimePublisher } from "../realtime.js";
import {
  addressBookEntry,
  addressBookPhoneStar,
  company,
  driver,
  driverAvailabilityEvent,
  driverCompany,
  session,
  user,
  userCredential,
} from "../schema.js";
import {
  availabilityLeaseMs,
  checkInAvailability,
  readAvailability,
  recordAvailabilityLapse,
  setAvailability,
} from "./availability.js";
import { registerAvailabilityRoutes } from "./http.js";

const start = new Date("2026-10-11T16:00:00.000Z");

describe("availability", () => {
  let app: FastifyInstance;

  before(async () => {
    await migrateDatabase();
    app = Fastify();
    registerAvailabilityRoutes(app, { now: () => start });
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it("rejects a missing session and a bad body", async () => {
    const missing = await app.inject({ method: "GET", url: "/availability" });
    assert.equal(missing.statusCode, 401);
    const person = await createSession({
      sub: `availability-auth-${crypto.randomUUID()}`,
      displayName: "Auth",
      email: null,
    });
    try {
      const rejected = await app.inject({
        method: "PUT",
        url: "/availability",
        headers: { authorization: `Bearer ${person.token}` },
        payload: { available: "yes" },
      });
      assert.equal(rejected.statusCode, 400);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("stores the driver's choice and does not show another driver's flag", async () => {
    const person = await createSession({
      sub: `availability-own-${crypto.randomUUID()}`,
      displayName: "Own",
      email: null,
    });
    const other = await createSession({
      sub: `availability-other-${crypto.randomUUID()}`,
      displayName: "Other",
      email: null,
    });
    const events: RealtimeEnvelope[] = [];
    try {
      const initial = await readAvailability(person.user, start);
      assert.equal(initial.available, false);
      assert.equal(initial.current, false);

      await withRealtimePublisher(
        (envelope) => {
          events.push(envelope);
        },
        async () => {
          const chosen = await setAvailability(person.user, true, start);
          assert.equal(chosen.available, true);
          assert.equal(chosen.current, true);
          const again = await setAvailability(person.user, true, start);
          assert.equal(again.available, true);
          assert.deepEqual(events.map((event) => event.type), ["availability.updated"]);
          const published = events[0];
          assert.equal(published?.type, "availability.updated");
          if (published?.type === "availability.updated") {
            assert.equal(published.userId, person.user.id);
            assert.equal(published.available, true);
            assert.equal(published.current, true);
          }
        },
      );

      const otherView = await readAvailability(other.user, start);
      assert.equal(otherView.available, false);
      assert.equal(otherView.current, false);
      const rows = await eventsFor(person.user.id);
      assert.equal(rows.length, 1);
    } finally {
      await removeUser(person.user.id);
      await removeUser(other.user.id);
    }
  });

  it("refreshes a current check-in without an event and ignores a check-in when unavailable", async () => {
    const person = await createSession({
      sub: `availability-ping-${crypto.randomUUID()}`,
      displayName: "Ping",
      email: null,
    });
    const events: RealtimeEnvelope[] = [];
    try {
      await setAvailability(person.user, true, start);
      const before = await checkedAt(person.user.id);
      const later = new Date(start.getTime() + 60_000);
      await withRealtimePublisher(
        (envelope) => {
          events.push(envelope);
        },
        async () => {
          const refreshed = await checkInAvailability(person.user, later);
          assert.equal(refreshed.available, true);
          assert.equal(refreshed.current, true);
        },
      );
      assert.equal(events.length, 0);
      const after = await checkedAt(person.user.id);
      assert.notEqual(after?.getTime(), before?.getTime());
      assert.equal((await eventsFor(person.user.id)).length, 1);

      await setAvailability(person.user, false, later);
      const declined: RealtimeEnvelope[] = [];
      await withRealtimePublisher(
        (envelope) => {
          declined.push(envelope);
        },
        async () => {
          const ignored = await checkInAvailability(person.user, later);
          assert.equal(ignored.available, false);
          assert.equal(ignored.current, false);
        },
      );
      assert.equal(declined.length, 0);
      assert.equal((await eventsFor(person.user.id)).length, 2);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("lapses once after five minutes and a later check-in restores reachability", async () => {
    const person = await createSession({
      sub: `availability-lapse-${crypto.randomUUID()}`,
      displayName: "Lapse",
      email: null,
    });
    const events: RealtimeEnvelope[] = [];
    try {
      await setAvailability(person.user, true, start);
      const exactly = new Date(start.getTime() + availabilityLeaseMs);
      const past = new Date(start.getTime() + availabilityLeaseMs + 1);
      await withRealtimePublisher(
        (envelope) => {
          events.push(envelope);
        },
        async () => {
          await recordAvailabilityLapse(exactly);
          assert.equal(events.length, 0);
          const still = await readAvailability(person.user, exactly);
          assert.equal(still.available, true);
          assert.equal(still.current, true);

          await recordAvailabilityLapse(past);
          await recordAvailabilityLapse(past);
          const lapsed = await readAvailability(person.user, past);
          assert.equal(lapsed.available, true);
          assert.equal(lapsed.current, false);

          const restored = await checkInAvailability(person.user, past);
          assert.equal(restored.available, true);
          assert.equal(restored.current, true);
        },
      );
      const published = events.filter((event) => event.type === "availability.updated");
      assert.equal(published.length, 2);
      assert.equal(published[0]?.type, "availability.updated");
      assert.equal(published[1]?.type, "availability.updated");
      if (published[0]?.type === "availability.updated" && published[1]?.type === "availability.updated") {
        assert.equal(published[0].current, false);
        assert.equal(published[0].available, true);
        assert.equal(published[1].current, true);
        assert.equal(published[1].available, true);
      }
      const rows = await eventsFor(person.user.id);
      assert.deepEqual(
        rows.map((row) => row.current),
        [true, false, true],
      );
      assert.equal(rows.every((row) => row.available), true);
    } finally {
      await removeUser(person.user.id);
    }
  });

  it("deletes a user who only toggled availability", async () => {
    const caller = await createSession({
      sub: `availability-caller-${crypto.randomUUID()}`,
      displayName: "Caller",
      email: null,
    });
    const person = await createSession({
      sub: `availability-delete-${crypto.randomUUID()}`,
      displayName: "Delete",
      email: null,
    });
    try {
      await setAvailability(person.user, true, start);
      const driverId = await driverFor(person.user.id);
      const links = await db
        .select({ companyId: driverCompany.companyId })
        .from(driverCompany)
        .where(eq(driverCompany.driverId, driverId));
      assert.equal(await deleteDirectoryUser(caller.user.id, person.user.id), "ok");
      const remaining = await db.select({ id: user.id }).from(user).where(eq(user.id, person.user.id));
      assert.equal(remaining.length, 0);
      for (const link of links) {
        await db.delete(company).where(eq(company.id, link.companyId));
      }
    } finally {
      await removeUser(caller.user.id);
      await removeUser(person.user.id);
    }
  });
});

async function driverFor(userId: string): Promise<string> {
  const rows = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("driver missing");
  }
  return row.id;
}

async function checkedAt(userId: string): Promise<Date | null> {
  const rows = await db
    .select({ availabilityCheckedAt: driver.availabilityCheckedAt })
    .from(driver)
    .where(eq(driver.userId, userId))
    .limit(1);
  return rows[0]?.availabilityCheckedAt ?? null;
}

async function eventsFor(userId: string): Promise<{ available: boolean; current: boolean }[]> {
  const driverId = await driverFor(userId);
  return db
    .select({ available: driverAvailabilityEvent.available, current: driverAvailabilityEvent.current })
    .from(driverAvailabilityEvent)
    .where(eq(driverAvailabilityEvent.driverId, driverId))
    .orderBy(driverAvailabilityEvent.recordedAt);
}

async function removeUser(userId: string): Promise<void> {
  const drivers = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  for (const row of drivers) {
    const links = await db
      .select({ companyId: driverCompany.companyId })
      .from(driverCompany)
      .where(eq(driverCompany.driverId, row.id));
    await db.delete(driverCompany).where(eq(driverCompany.driverId, row.id));
    // A parallel lapse can insert an event after the first delete and before the driver goes.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await db.delete(addressBookEntry).where(eq(addressBookEntry.driverId, row.id));
      await db.delete(addressBookPhoneStar).where(eq(addressBookPhoneStar.driverId, row.id));
      await db.delete(driverAvailabilityEvent).where(eq(driverAvailabilityEvent.driverId, row.id));
      try {
        await db.delete(driver).where(eq(driver.id, row.id));
        break;
      } catch (error) {
        if (attempt === 4) {
          throw error;
        }
      }
    }
    for (const link of links) {
      await db.delete(company).where(eq(company.id, link.companyId));
    }
  }
  await db.delete(session).where(eq(session.userId, userId));
  await db.delete(userCredential).where(eq(userCredential.userId, userId));
  await db.delete(user).where(eq(user.id, userId));
}
