import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { closeDatabase, db } from "../db.js";
import { createSession } from "../identity/sessions.js";
import { migrateDatabase } from "../migrate.js";
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
import { registerAddressBookRoutes } from "./http.js";

let app: FastifyInstance;

before(async () => {
  await migrateDatabase();
  app = Fastify();
  registerAddressBookRoutes(app);
});

after(async () => {
  await app?.close();
  await closeDatabase();
});

describe("address book", () => {
  it("rejects a missing token", async () => {
    const missing = await app.inject({ method: "GET", url: "/address-book" });
    assert.equal(missing.statusCode, 401);
  });

  it("creates, lists favorites first, renames, stars, and deletes an entry", async () => {
    const person = await createSession({
      sub: `address-book-${crypto.randomUUID()}`,
      displayName: "Driver",
      email: `driver-${crypto.randomUUID()}@example.com`,
    });
    try {
      const oak = await app.inject({
        method: "POST",
        url: "/address-book",
        headers: auth(person.token),
        payload: { nickname: "  Oak  ", label: "  1 Oak St  ", latitude: 40.1, longitude: -75.2 },
      });
      assert.equal(oak.statusCode, 201);
      assert.equal(oak.json().nickname, "Oak");
      assert.equal(oak.json().placeName, "");
      assert.equal(oak.json().label, "1 Oak St");
      assert.equal(oak.json().favorite, false);

      const elm = await app.inject({
        method: "POST",
        url: "/address-book",
        headers: auth(person.token),
        payload: { nickname: "Elm", label: "2 Elm St", latitude: 40.2, longitude: -75.3 },
      });
      assert.equal(elm.statusCode, 201);
      const starred = await app.inject({
        method: "PATCH",
        url: `/address-book/${elm.json().id}`,
        headers: auth(person.token),
        payload: { favorite: true },
      });
      assert.equal(starred.statusCode, 200);
      assert.equal(starred.json().favorite, true);

      const renamed = await app.inject({
        method: "PATCH",
        url: `/address-book/${oak.json().id}`,
        headers: auth(person.token),
        payload: { nickname: "  Pine  " },
      });
      assert.equal(renamed.statusCode, 200);
      assert.equal(renamed.json().nickname, "Pine");

      const listed = await app.inject({ method: "GET", url: "/address-book", headers: auth(person.token) });
      assert.equal(listed.statusCode, 200);
      const names = listed.json().entries.map((entry: { nickname: string }) => entry.nickname);
      assert.deepEqual(names, ["Elm", "Pine"]);

      const blank = await app.inject({
        method: "POST",
        url: "/address-book",
        headers: auth(person.token),
        payload: { nickname: "Oak", label: "   ", latitude: 1, longitude: 2 },
      });
      assert.equal(blank.statusCode, 400);

      const removed = await app.inject({
        method: "DELETE",
        url: `/address-book/${elm.json().id}`,
        headers: auth(person.token),
      });
      assert.equal(removed.statusCode, 204);
      const afterDelete = await app.inject({ method: "GET", url: "/address-book", headers: auth(person.token) });
      assert.deepEqual(
        afterDelete.json().entries.map((entry: { id: string }) => entry.id),
        [oak.json().id],
      );
    } finally {
      await removePerson(person.user.id);
    }
  });

  it("keeps one driver's book hidden from another", async () => {
    const owner = await createSession({
      sub: `address-owner-${crypto.randomUUID()}`,
      displayName: "Owner",
      email: `owner-${crypto.randomUUID()}@example.com`,
    });
    const other = await createSession({
      sub: `address-other-${crypto.randomUUID()}`,
      displayName: "Other",
      email: `other-${crypto.randomUUID()}@example.com`,
    });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/address-book",
        headers: auth(owner.token),
        payload: { nickname: "Hangar", label: "3 Ramp Rd", latitude: 41, longitude: -74 },
      });
      assert.equal(created.statusCode, 201);
      const id = created.json().id as string;

      const hidden = await app.inject({ method: "GET", url: "/address-book", headers: auth(other.token) });
      assert.equal(hidden.statusCode, 200);
      assert.equal(
        hidden.json().entries.some((entry: { id: string }) => entry.id === id),
        false,
      );

      const patched = await app.inject({
        method: "PATCH",
        url: `/address-book/${id}`,
        headers: auth(other.token),
        payload: { nickname: "Taken" },
      });
      assert.equal(patched.statusCode, 404);

      const deleted = await app.inject({
        method: "DELETE",
        url: `/address-book/${id}`,
        headers: auth(other.token),
      });
      assert.equal(deleted.statusCode, 404);

      const still = await app.inject({ method: "GET", url: "/address-book", headers: auth(owner.token) });
      assert.equal(still.json().entries[0].nickname, "Hangar");
    } finally {
      await removePerson(owner.user.id);
      await removePerson(other.user.id);
    }
  });

  it("stores a place name and moves the location with both coordinates", async () => {
    const person = await createSession({
      sub: `address-place-${crypto.randomUUID()}`,
      displayName: "Driver",
      email: `place-${crypto.randomUUID()}@example.com`,
    });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/address-book",
        headers: auth(person.token),
        payload: { placeName: "  Denny's  ", label: "  9 Main St  ", latitude: 40.3, longitude: -75.4 },
      });
      assert.equal(created.statusCode, 201);
      assert.equal(created.json().nickname, "");
      assert.equal(created.json().placeName, "Denny's");
      assert.equal(created.json().label, "9 Main St");

      const half = await app.inject({
        method: "PATCH",
        url: `/address-book/${created.json().id}`,
        headers: auth(person.token),
        payload: { label: "Moved" },
      });
      assert.equal(half.statusCode, 400);

      const empty = await app.inject({
        method: "PATCH",
        url: `/address-book/${created.json().id}`,
        headers: auth(person.token),
        payload: {},
      });
      assert.equal(empty.statusCode, 400);

      const moved = await app.inject({
        method: "PATCH",
        url: `/address-book/${created.json().id}`,
        headers: auth(person.token),
        payload: {
          nickname: " Breakfast ",
          placeName: " Pine Diner ",
          label: " 4 Pine St ",
          latitude: 40.4,
          longitude: -75.5,
        },
      });
      assert.equal(moved.statusCode, 200);
      assert.equal(moved.json().nickname, "Breakfast");
      assert.equal(moved.json().placeName, "Pine Diner");
      assert.equal(moved.json().label, "4 Pine St");
      assert.equal(moved.json().latitude, 40.4);
      assert.equal(moved.json().longitude, -75.5);
    } finally {
      await removePerson(person.user.id);
    }
  });

  it("stores a phone star as the driver and the two device ids", async () => {
    const person = await createSession({
      sub: `phone-star-${crypto.randomUUID()}`,
      displayName: "Driver",
      email: `star-${crypto.randomUUID()}@example.com`,
    });
    const other = await createSession({
      sub: `phone-star-other-${crypto.randomUUID()}`,
      displayName: "Other",
      email: `star-other-${crypto.randomUUID()}@example.com`,
    });
    const contactId = `contact-${crypto.randomUUID()}`;
    const addressId = `address-${crypto.randomUUID()}`;
    try {
      const starred = await app.inject({
        method: "POST",
        url: "/address-book/phone-stars",
        headers: auth(person.token),
        payload: { contactId, addressId },
      });
      assert.equal(starred.statusCode, 204);
      const again = await app.inject({
        method: "POST",
        url: "/address-book/phone-stars",
        headers: auth(person.token),
        payload: { contactId: `  ${contactId}  `, addressId },
      });
      assert.equal(again.statusCode, 204);

      const columns = await db.execute(sql<{ column_name: string }>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'address_book_phone_star'
        ORDER BY column_name
      `);
      assert.deepEqual(
        Array.from(columns, (row) => row.column_name),
        ["address_id", "contact_id", "driver_id"],
      );

      const author = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, person.user.id));
      const driverId = author[0]?.id;
      assert.ok(driverId);
      const stored = await db
        .select()
        .from(addressBookPhoneStar)
        .where(eq(addressBookPhoneStar.driverId, driverId));
      assert.deepEqual(stored, [{ driverId, contactId, addressId }]);

      const listed = await app.inject({ method: "GET", url: "/address-book", headers: auth(person.token) });
      assert.deepEqual(listed.json().phoneStars, [{ contactId, addressId }]);

      const hidden = await app.inject({ method: "GET", url: "/address-book", headers: auth(other.token) });
      assert.deepEqual(hidden.json().phoneStars, []);
      const foreign = await app.inject({
        method: "DELETE",
        url: "/address-book/phone-stars",
        headers: auth(other.token),
        payload: { contactId, addressId },
      });
      assert.equal(foreign.statusCode, 204);
      const kept = await db
        .select()
        .from(addressBookPhoneStar)
        .where(eq(addressBookPhoneStar.driverId, driverId));
      assert.equal(kept.length, 1);

      const cleared = await app.inject({
        method: "DELETE",
        url: "/address-book/phone-stars",
        headers: auth(person.token),
        payload: { contactId, addressId },
      });
      assert.equal(cleared.statusCode, 204);
      const repeat = await app.inject({
        method: "DELETE",
        url: "/address-book/phone-stars",
        headers: auth(person.token),
        payload: { contactId, addressId },
      });
      assert.equal(repeat.statusCode, 204);
      const gone = await db.select().from(addressBookPhoneStar).where(eq(addressBookPhoneStar.driverId, driverId));
      assert.equal(gone.length, 0);

      const blank = await app.inject({
        method: "POST",
        url: "/address-book/phone-stars",
        headers: auth(person.token),
        payload: { contactId: "  ", addressId },
      });
      assert.equal(blank.statusCode, 400);
    } finally {
      await removePerson(person.user.id);
      await removePerson(other.user.id);
    }
  });
});

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function removePerson(userId: string): Promise<void> {
  const drivers = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  for (const row of drivers) {
    await db.delete(addressBookEntry).where(eq(addressBookEntry.driverId, row.id));
    await db.delete(addressBookPhoneStar).where(eq(addressBookPhoneStar.driverId, row.id));
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
    await db.delete(driverAvailabilityEvent).where(eq(driverAvailabilityEvent.driverId, row.id));
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
