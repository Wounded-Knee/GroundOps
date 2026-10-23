import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { closeDatabase, db } from "../db.js";
import { createSession } from "../identity/sessions.js";
import { migrateDatabase } from "../migrate.js";
import {
  addressBookCompanyShare,
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

  it("shares one company entry with members and keeps it owned by the origin account", async () => {
    const owner = await createSession({
      sub: `share-owner-${crypto.randomUUID()}`,
      displayName: "Owner",
      email: `share-owner-${crypto.randomUUID()}@example.com`,
    });
    const member = await createSession({
      sub: `share-member-${crypto.randomUUID()}`,
      displayName: "Member",
      email: `share-member-${crypto.randomUUID()}@example.com`,
    });
    const joiner = await createSession({
      sub: `share-joiner-${crypto.randomUUID()}`,
      displayName: "Joiner",
      email: `share-joiner-${crypto.randomUUID()}@example.com`,
    });
    const stranger = await createSession({
      sub: `share-stranger-${crypto.randomUUID()}`,
      displayName: "Stranger",
      email: `share-stranger-${crypto.randomUUID()}@example.com`,
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
      assert.equal(created.json().owned, true);
      assert.equal(created.json().companyShared, false);
      assert.equal(created.json().platformShared, false);

      const ownerDriver = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, owner.user.id));
      const ownerDriverId = ownerDriver[0]?.id;
      assert.ok(ownerDriverId);
      const ownerLinks = await db.select().from(driverCompany).where(eq(driverCompany.driverId, ownerDriverId));
      assert.equal(ownerLinks.length, 1);
      assert.equal(ownerLinks[0]?.administrator, true);
      const companyId = ownerLinks[0]?.companyId;
      assert.ok(companyId);

      await app.inject({ method: "GET", url: "/address-book", headers: auth(member.token) });
      await app.inject({ method: "GET", url: "/address-book", headers: auth(joiner.token) });
      const memberDriver = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, member.user.id));
      const joinerDriver = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, joiner.user.id));
      const memberDriverId = memberDriver[0]?.id;
      const joinerDriverId = joinerDriver[0]?.id;
      assert.ok(memberDriverId);
      assert.ok(joinerDriverId);
      await db.insert(driverCompany).values({ driverId: memberDriverId, companyId, administrator: false });

      const before = await app.inject({ method: "GET", url: "/address-book", headers: auth(member.token) });
      assert.equal(before.json().entries.some((entry: { id: string }) => entry.id === id), false);

      const shared = await app.inject({
        method: "POST",
        url: `/address-book/${id}/company-share`,
        headers: auth(owner.token),
      });
      assert.equal(shared.statusCode, 200);
      assert.equal(shared.json().id, id);
      assert.equal(shared.json().companyShared, true);
      assert.equal(shared.json().owned, true);
      const grants = await db.select().from(addressBookCompanyShare).where(eq(addressBookCompanyShare.entryId, id));
      assert.equal(grants.length, 1);
      assert.equal(grants[0]?.companyId, companyId);
      const stored = await db.select().from(addressBookEntry).where(eq(addressBookEntry.id, id));
      assert.equal(stored.length, 1);

      const book = await app.inject({ method: "GET", url: "/address-book", headers: auth(owner.token) });
      assert.equal(book.json().canShareWithCompany, true);
      assert.equal(book.json().canShareWithPlatform, false);

      const seen = await app.inject({ method: "GET", url: "/address-book", headers: auth(member.token) });
      const received = seen.json().entries.find((entry: { id: string }) => entry.id === id);
      assert.equal(received.nickname, "Hangar");
      assert.equal(received.owned, false);
      assert.equal(received.label, "3 Ramp Rd");

      const hidden = await app.inject({ method: "GET", url: "/address-book", headers: auth(stranger.token) });
      assert.equal(hidden.json().entries.some((entry: { id: string }) => entry.id === id), false);

      const starred = await app.inject({
        method: "POST",
        url: "/address-book/phone-stars",
        headers: auth(owner.token),
        payload: { contactId: "contact", addressId: "address" },
      });
      assert.equal(starred.statusCode, 204);
      const memberStars = await app.inject({ method: "GET", url: "/address-book", headers: auth(member.token) });
      assert.deepEqual(memberStars.json().phoneStars, []);

      const renamed = await app.inject({
        method: "PATCH",
        url: `/address-book/${id}`,
        headers: auth(owner.token),
        payload: { nickname: "Ramp" },
      });
      assert.equal(renamed.statusCode, 200);
      const synced = await app.inject({ method: "GET", url: "/address-book", headers: auth(member.token) });
      assert.equal(synced.json().entries.find((entry: { id: string }) => entry.id === id).nickname, "Ramp");
      const stillOne = await db.select().from(addressBookEntry).where(eq(addressBookEntry.id, id));
      assert.equal(stillOne.length, 1);

      await db.insert(driverCompany).values({ driverId: joinerDriverId, companyId, administrator: false });
      const joined = await app.inject({ method: "GET", url: "/address-book", headers: auth(joiner.token) });
      assert.equal(joined.json().entries.some((entry: { id: string }) => entry.id === id), true);
      await db
        .delete(driverCompany)
        .where(and(eq(driverCompany.driverId, joinerDriverId), eq(driverCompany.companyId, companyId)));
      const left = await app.inject({ method: "GET", url: "/address-book", headers: auth(joiner.token) });
      assert.equal(left.json().entries.some((entry: { id: string }) => entry.id === id), false);

      const patched = await app.inject({
        method: "PATCH",
        url: `/address-book/${id}`,
        headers: auth(member.token),
        payload: { nickname: "Taken" },
      });
      assert.equal(patched.statusCode, 404);
      const deleted = await app.inject({
        method: "DELETE",
        url: `/address-book/${id}`,
        headers: auth(member.token),
      });
      assert.equal(deleted.statusCode, 404);
      const memberShare = await app.inject({
        method: "POST",
        url: `/address-book/${id}/company-share`,
        headers: auth(member.token),
      });
      assert.equal(memberShare.statusCode, 404);
      const platform = await app.inject({
        method: "POST",
        url: `/address-book/${id}/platform-share`,
        headers: auth(owner.token),
      });
      assert.equal(platform.statusCode, 403);

      const unshared = await app.inject({
        method: "DELETE",
        url: `/address-book/${id}/company-share`,
        headers: auth(owner.token),
      });
      assert.equal(unshared.statusCode, 200);
      assert.equal(unshared.json().companyShared, false);
      const withdrawn = await app.inject({ method: "GET", url: "/address-book", headers: auth(member.token) });
      assert.equal(withdrawn.json().entries.some((entry: { id: string }) => entry.id === id), false);
      const again = await app.inject({
        method: "POST",
        url: `/address-book/${id}/company-share`,
        headers: auth(owner.token),
      });
      assert.equal(again.statusCode, 200);

      const removed = await app.inject({
        method: "DELETE",
        url: `/address-book/${id}`,
        headers: auth(owner.token),
      });
      assert.equal(removed.statusCode, 204);
      const afterDelete = await app.inject({ method: "GET", url: "/address-book", headers: auth(member.token) });
      assert.equal(afterDelete.json().entries.some((entry: { id: string }) => entry.id === id), false);
      const grantsGone = await db.select().from(addressBookCompanyShare).where(eq(addressBookCompanyShare.entryId, id));
      assert.equal(grantsGone.length, 0);
    } finally {
      await removePerson(member.user.id);
      await removePerson(joiner.user.id);
      await removePerson(stranger.user.id);
      await removePerson(owner.user.id);
    }
  });

  it("shares one platform entry with every signed-in user", async () => {
    const previous = process.env.PLATFORM_ADMINISTRATOR_EMAILS;
    const email = `platform-share-${crypto.randomUUID()}@example.com`;
    process.env.PLATFORM_ADMINISTRATOR_EMAILS = email;
    const admin = await createSession({
      sub: `platform-share-${crypto.randomUUID()}`,
      displayName: "Platform",
      email,
    });
    const reader = await createSession({
      sub: `platform-reader-${crypto.randomUUID()}`,
      displayName: "Reader",
      email: `platform-reader-${crypto.randomUUID()}@example.com`,
    });
    try {
      assert.equal(admin.user.platformAdministrator, true);
      await db.insert(driver).values({ userId: admin.user.id });
      const created = await app.inject({
        method: "POST",
        url: "/address-book",
        headers: auth(admin.token),
        payload: { nickname: "Yard", label: "9 Yard", latitude: 42, longitude: -73 },
      });
      assert.equal(created.statusCode, 201);
      const id = created.json().id as string;

      const companyShare = await app.inject({
        method: "POST",
        url: `/address-book/${id}/company-share`,
        headers: auth(admin.token),
      });
      assert.equal(companyShare.statusCode, 403);

      const shared = await app.inject({
        method: "POST",
        url: `/address-book/${id}/platform-share`,
        headers: auth(admin.token),
      });
      assert.equal(shared.statusCode, 200);
      assert.equal(shared.json().platformShared, true);
      assert.equal(shared.json().id, id);
      const rows = await db.select().from(addressBookEntry).where(eq(addressBookEntry.id, id));
      assert.equal(rows.length, 1);

      const seen = await app.inject({ method: "GET", url: "/address-book", headers: auth(reader.token) });
      const received = seen.json().entries.find((entry: { id: string }) => entry.id === id);
      assert.equal(received.nickname, "Yard");
      assert.equal(received.owned, false);
      const readerShare = await app.inject({
        method: "POST",
        url: `/address-book/${id}/platform-share`,
        headers: auth(reader.token),
      });
      assert.equal(readerShare.statusCode, 404);

      const cleared = await app.inject({
        method: "DELETE",
        url: `/address-book/${id}/platform-share`,
        headers: auth(admin.token),
      });
      assert.equal(cleared.statusCode, 200);
      assert.equal(cleared.json().platformShared, false);
      const hidden = await app.inject({ method: "GET", url: "/address-book", headers: auth(reader.token) });
      assert.equal(hidden.json().entries.some((entry: { id: string }) => entry.id === id), false);
    } finally {
      if (previous === undefined) {
        delete process.env.PLATFORM_ADMINISTRATOR_EMAILS;
      } else {
        process.env.PLATFORM_ADMINISTRATOR_EMAILS = previous;
      }
      await removePerson(reader.user.id);
      await removePerson(admin.user.id);
    }
  });
});

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function removePerson(userId: string): Promise<void> {
  const drivers = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, userId));
  for (const row of drivers) {
    const entries = await db.select({ id: addressBookEntry.id }).from(addressBookEntry).where(eq(addressBookEntry.driverId, row.id));
    if (entries.length > 0) {
      await db.delete(addressBookCompanyShare).where(
        inArray(
          addressBookCompanyShare.entryId,
          entries.map((entry) => entry.id),
        ),
      );
    }
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
      const remaining = await db
        .select({ id: driverCompany.id })
        .from(driverCompany)
        .where(eq(driverCompany.companyId, link.companyId))
        .limit(1);
      if (remaining[0]) {
        continue;
      }
      await db.delete(addressBookCompanyShare).where(eq(addressBookCompanyShare.companyId, link.companyId));
      await db.delete(company).where(eq(company.id, link.companyId));
    }
  }
  await db.delete(session).where(eq(session.userId, userId));
  await db.delete(userCredential).where(eq(userCredential.userId, userId));
  await db.delete(user).where(eq(user.id, userId));
}
