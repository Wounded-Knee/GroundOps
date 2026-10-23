import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { ensureDriver } from "../calendar/calendar.js";
import { closeDatabase, db } from "../db.js";
import { findActiveSession, createSession } from "../identity/sessions.js";
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
  facility,
  locationObservation,
  operationalEvent,
  session,
  sortie,
  sortieStop,
  user,
  userCredential,
} from "../schema.js";
import { registerPlatformRoutes } from "./http.js";

const adminEmail = `Directory-Admin-${crypto.randomUUID()}@Example.com`;
let previousAllowlist: string | undefined;
let app: FastifyInstance;
let adminToken = "";
let adminId = "";

before(async () => {
  previousAllowlist = process.env.PLATFORM_ADMINISTRATOR_EMAILS;
  process.env.PLATFORM_ADMINISTRATOR_EMAILS = ` ${adminEmail} `;
  await migrateDatabase();
  const admin = await createSession({
    sub: `directory-admin-${crypto.randomUUID()}`,
    displayName: "Directory Admin",
    email: adminEmail,
  });
  adminToken = admin.token;
  adminId = admin.user.id;
  assert.equal(admin.user.platformAdministrator, true);
  app = Fastify();
  registerPlatformRoutes(app);
});

after(async () => {
  if (previousAllowlist === undefined) {
    delete process.env.PLATFORM_ADMINISTRATOR_EMAILS;
  } else {
    process.env.PLATFORM_ADMINISTRATOR_EMAILS = previousAllowlist;
  }
  if (adminId) {
    await removeUser(adminId);
  }
  await app.close();
  await closeDatabase();
});

describe("platform directory", () => {
  it("rejects a missing token and a signed-in non-administrator", async () => {
    const outsider = await createSession({
      sub: `directory-outsider-${crypto.randomUUID()}`,
      displayName: "Outsider",
      email: `outsider-${crypto.randomUUID()}@example.com`,
    });
    const name = `Blocked ${crypto.randomUUID()}`;
    try {
      assert.equal(outsider.user.platformAdministrator, false);
      const missing = await app.inject({ method: "GET", url: "/companies" });
      assert.equal(missing.statusCode, 401);

      const forbidden = await app.inject({
        method: "POST",
        url: "/companies",
        headers: { authorization: `Bearer ${outsider.token}` },
        payload: { name },
      });
      assert.equal(forbidden.statusCode, 403);
      assert.equal(await companyNamed(name), null);
    } finally {
      await removeUser(outsider.user.id);
    }
  });

  it("lists, creates, edits, and deletes a company, a facility, and a user", async () => {
    const companyName = `North ${crypto.randomUUID()}`;
    const facilityName = `Stand ${crypto.randomUUID()}`;
    const userName = `Pat ${crypto.randomUUID()}`;
    let companyId = "";
    let facilityId = "";
    let userId = "";
    try {
      const createdCompany = await app.inject({
        method: "POST",
        url: "/companies",
        headers: auth(adminToken),
        payload: { name: `  ${companyName}  ` },
      });
      assert.equal(createdCompany.statusCode, 201);
      companyId = createdCompany.json().id as string;
      assert.equal(createdCompany.json().name, companyName);

      const renamedCompany = await app.inject({
        method: "PATCH",
        url: `/companies/${companyId}`,
        headers: auth(adminToken),
        payload: { name: `${companyName} renamed` },
      });
      assert.equal(renamedCompany.statusCode, 200);
      const companies = await app.inject({ method: "GET", url: "/companies", headers: auth(adminToken) });
      assert.equal(companies.statusCode, 200);
      assert.equal(
        companies.json().companies.some((row: { id: string; name: string }) => row.id === companyId && row.name === `${companyName} renamed`),
        true,
      );

      const createdFacility = await app.inject({
        method: "POST",
        url: "/facilities",
        headers: auth(adminToken),
        payload: { name: facilityName },
      });
      assert.equal(createdFacility.statusCode, 201);
      facilityId = createdFacility.json().id as string;
      const renamedFacility = await app.inject({
        method: "PATCH",
        url: `/facilities/${facilityId}`,
        headers: auth(adminToken),
        payload: { name: `${facilityName} renamed` },
      });
      assert.equal(renamedFacility.statusCode, 200);

      const createdUser = await app.inject({
        method: "POST",
        url: "/users",
        headers: auth(adminToken),
        payload: { displayName: `  ${userName}  `, email: "  " },
      });
      assert.equal(createdUser.statusCode, 201);
      userId = createdUser.json().id as string;
      assert.equal(createdUser.json().displayName, userName);
      assert.equal(createdUser.json().email, null);
      const credentials = await db
        .select({ id: userCredential.id })
        .from(userCredential)
        .where(eq(userCredential.userId, userId));
      assert.equal(credentials.length, 0);

      const renamedUser = await app.inject({
        method: "PATCH",
        url: `/users/${userId}`,
        headers: auth(adminToken),
        payload: { displayName: `${userName} renamed`, email: "pat@example.com" },
      });
      assert.equal(renamedUser.statusCode, 200);
      const users = await app.inject({ method: "GET", url: "/users", headers: auth(adminToken) });
      assert.equal(
        users.json().users.some((row: { id: string; email: string | null }) => row.id === userId && row.email === "pat@example.com"),
        true,
      );

      assert.equal((await app.inject({ method: "DELETE", url: `/companies/${companyId}`, headers: auth(adminToken) })).statusCode, 204);
      assert.equal(await companyById(companyId), null);
      companyId = "";
      assert.equal((await app.inject({ method: "DELETE", url: `/facilities/${facilityId}`, headers: auth(adminToken) })).statusCode, 204);
      assert.equal(await facilityById(facilityId), null);
      facilityId = "";
      assert.equal((await app.inject({ method: "DELETE", url: `/users/${userId}`, headers: auth(adminToken) })).statusCode, 204);
      assert.equal(await userById(userId), null);
      userId = "";
    } finally {
      if (companyId) {
        await db.delete(company).where(eq(company.id, companyId));
      }
      if (facilityId) {
        await db.delete(facility).where(eq(facility.id, facilityId));
      }
      if (userId) {
        await removeUser(userId);
      }
    }
  });

  it("rejects a blank name and an unknown id", async () => {
    const blank = await app.inject({
      method: "POST",
      url: "/facilities",
      headers: auth(adminToken),
      payload: { name: "   " },
    });
    assert.equal(blank.statusCode, 400);
    const missing = await app.inject({
      method: "PATCH",
      url: `/companies/${crypto.randomUUID()}`,
      headers: auth(adminToken),
      payload: { name: "Missing" },
    });
    assert.equal(missing.statusCode, 404);
  });

  it("refuses to delete a company that still has a driver link or a sortie", async () => {
    const person = await createSession({
      sub: `directory-driver-${crypto.randomUUID()}`,
      displayName: "Linked Driver",
      email: `linked-${crypto.randomUUID()}@example.com`,
    });
    let sortieCompanyId = "";
    try {
      await ensureDriver(person.user);
      const linked = await db
        .select({ companyId: driverCompany.companyId, driverId: driver.id })
        .from(driverCompany)
        .innerJoin(driver, eq(driver.id, driverCompany.driverId))
        .where(eq(driver.userId, person.user.id));
      const link = linked[0];
      assert.ok(link);
      const blockedLink = await app.inject({
        method: "DELETE",
        url: `/companies/${link.companyId}`,
        headers: auth(adminToken),
      });
      assert.equal(blockedLink.statusCode, 409);
      assert.ok(await companyById(link.companyId));

      const created = await db
        .insert(company)
        .values({ name: `Sortie company ${crypto.randomUUID()}` })
        .returning({ id: company.id });
      sortieCompanyId = created[0]?.id ?? "";
      const when = new Date("2026-10-10T15:00:00.000Z");
      await db.insert(sortie).values({
        companyId: sortieCompanyId,
        authorDriverId: link.driverId,
        type: "task",
        label: "Held",
        arrivalAt: when,
        scheduledStart: when,
        scheduledEnd: new Date("2026-10-10T16:00:00.000Z"),
      });
      const blockedSortie = await app.inject({
        method: "DELETE",
        url: `/companies/${sortieCompanyId}`,
        headers: auth(adminToken),
      });
      assert.equal(blockedSortie.statusCode, 409);
      assert.ok(await companyById(sortieCompanyId));
    } finally {
      await removeUser(person.user.id);
      if (sortieCompanyId) {
        await db.delete(company).where(eq(company.id, sortieCompanyId));
      }
    }
  });

  it("refuses to delete a user who still has a sortie, and removes a user who has only a session", async () => {
    const busyPerson = await createSession({
      sub: `directory-busy-${crypto.randomUUID()}`,
      displayName: "Busy Driver",
      email: `busy-${crypto.randomUUID()}@example.com`,
    });
    const idlePerson = await createSession({
      sub: `directory-idle-${crypto.randomUUID()}`,
      displayName: "Idle Person",
      email: `idle-${crypto.randomUUID()}@example.com`,
    });
    try {
      const busyDriver = await ensureDriver(busyPerson.user);
      const linked = await db
        .select({ companyId: driverCompany.companyId })
        .from(driverCompany)
        .where(eq(driverCompany.driverId, busyDriver.id));
      const when = new Date("2026-10-10T15:00:00.000Z");
      await db.insert(sortie).values({
        companyId: linked[0]?.companyId ?? "",
        authorDriverId: busyDriver.id,
        type: "task",
        label: "Held",
        arrivalAt: when,
        scheduledStart: when,
        scheduledEnd: new Date("2026-10-10T16:00:00.000Z"),
      });
      const blocked = await app.inject({
        method: "DELETE",
        url: `/users/${busyPerson.user.id}`,
        headers: auth(adminToken),
      });
      assert.equal(blocked.statusCode, 409);
      assert.ok(await userById(busyPerson.user.id));

      const self = await app.inject({
        method: "DELETE",
        url: `/users/${adminId}`,
        headers: auth(adminToken),
      });
      assert.equal(self.statusCode, 409);
      assert.ok(await findActiveSession(adminToken));

      const removed = await app.inject({
        method: "DELETE",
        url: `/users/${idlePerson.user.id}`,
        headers: auth(adminToken),
      });
      assert.equal(removed.statusCode, 204);
      assert.equal(await findActiveSession(idlePerson.token), null);
      assert.equal(await userById(idlePerson.user.id), null);
      const credentials = await db
        .select({ id: userCredential.id })
        .from(userCredential)
        .where(eq(userCredential.userId, idlePerson.user.id));
      assert.equal(credentials.length, 0);
      const sessions = await db.select({ id: session.id }).from(session).where(eq(session.userId, idlePerson.user.id));
      assert.equal(sessions.length, 0);
    } finally {
      await removeUser(busyPerson.user.id);
      await removeUser(idlePerson.user.id);
    }
  });

  it("assigns company membership and an administrator flag without a personal company", async () => {
    const name = `Members ${crypto.randomUUID()}`;
    const person = await createSession({
      sub: `directory-member-${crypto.randomUUID()}`,
      displayName: "Member Person",
      email: `directory-member-${crypto.randomUUID()}@example.com`,
    });
    let companyId = "";
    try {
      const created = await app.inject({
        method: "POST",
        url: "/companies",
        headers: auth(adminToken),
        payload: { name },
      });
      assert.equal(created.statusCode, 201);
      companyId = created.json().id as string;

      const forbidden = await app.inject({
        method: "PUT",
        url: `/companies/${companyId}/members`,
        headers: auth(person.token),
        payload: { userId: person.user.id, administrator: false },
      });
      assert.equal(forbidden.statusCode, 403);

      const missingCompany = await app.inject({
        method: "GET",
        url: `/companies/${crypto.randomUUID()}/members`,
        headers: auth(adminToken),
      });
      assert.equal(missingCompany.statusCode, 404);

      const added = await app.inject({
        method: "PUT",
        url: `/companies/${companyId}/members`,
        headers: auth(adminToken),
        payload: { userId: person.user.id, administrator: false },
      });
      assert.equal(added.statusCode, 200);
      assert.equal(added.json().administrator, false);
      assert.equal(added.json().displayName, "Member Person");

      const listed = await app.inject({
        method: "GET",
        url: `/companies/${companyId}/members`,
        headers: auth(adminToken),
      });
      assert.equal(listed.statusCode, 200);
      assert.equal(listed.json().members.length, 1);
      assert.equal(listed.json().members[0].userId, person.user.id);
      assert.equal(listed.json().members[0].administrator, false);

      const drivers = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, person.user.id));
      assert.equal(drivers.length, 1);
      const driverId = drivers[0]?.id;
      assert.ok(driverId);
      const links = await db.select().from(driverCompany).where(eq(driverCompany.driverId, driverId));
      assert.equal(links.length, 1);
      assert.equal(links[0]?.companyId, companyId);
      assert.equal(links[0]?.administrator, false);

      await ensureDriver(person.user);
      const afterCalendar = await db.select().from(driverCompany).where(eq(driverCompany.driverId, driverId));
      assert.equal(afterCalendar.length, 1);

      const promoted = await app.inject({
        method: "PUT",
        url: `/companies/${companyId}/members`,
        headers: auth(adminToken),
        payload: { userId: person.user.id, administrator: true },
      });
      assert.equal(promoted.statusCode, 200);
      assert.equal(promoted.json().administrator, true);

      const removed = await app.inject({
        method: "DELETE",
        url: `/companies/${companyId}/members/${person.user.id}`,
        headers: auth(adminToken),
      });
      assert.equal(removed.statusCode, 204);
      const empty = await app.inject({
        method: "GET",
        url: `/companies/${companyId}/members`,
        headers: auth(adminToken),
      });
      assert.deepEqual(empty.json().members, []);
      const driverStill = await db.select({ id: driver.id }).from(driver).where(eq(driver.userId, person.user.id));
      assert.equal(driverStill.length, 1);

      const missingUser = await app.inject({
        method: "PUT",
        url: `/companies/${companyId}/members`,
        headers: auth(adminToken),
        payload: { userId: crypto.randomUUID(), administrator: false },
      });
      assert.equal(missingUser.statusCode, 404);
    } finally {
      if (companyId) {
        await app.inject({ method: "DELETE", url: `/companies/${companyId}`, headers: auth(adminToken) });
      }
      await removeUser(person.user.id);
    }
  });

  it("removes share grants when a company or a user is deleted", async () => {
    const name = `Grant ${crypto.randomUUID()}`;
    const person = await createSession({
      sub: `directory-grant-${crypto.randomUUID()}`,
      displayName: "Grant Person",
      email: `directory-grant-${crypto.randomUUID()}@example.com`,
    });
    let companyId = "";
    try {
      const created = await app.inject({
        method: "POST",
        url: "/companies",
        headers: auth(adminToken),
        payload: { name },
      });
      assert.equal(created.statusCode, 201);
      companyId = created.json().id as string;
      const author = await ensureDriver(person.user);
      const [entry] = await db
        .insert(addressBookEntry)
        .values({
          driverId: author.id,
          nickname: "Ramp",
          placeName: "",
          label: "1 Ramp",
          latitude: 1,
          longitude: 2,
        })
        .returning();
      assert.ok(entry);
      await db.insert(addressBookCompanyShare).values({ entryId: entry.id, companyId });

      const removed = await app.inject({
        method: "DELETE",
        url: `/companies/${companyId}`,
        headers: auth(adminToken),
      });
      assert.equal(removed.statusCode, 204);
      companyId = "";
      const shares = await db.select().from(addressBookCompanyShare).where(eq(addressBookCompanyShare.entryId, entry.id));
      assert.equal(shares.length, 0);
      const kept = await db.select().from(addressBookEntry).where(eq(addressBookEntry.id, entry.id));
      assert.equal(kept.length, 1);

      const links = await db
        .select({ companyId: driverCompany.companyId, administrator: driverCompany.administrator })
        .from(driverCompany)
        .where(eq(driverCompany.driverId, author.id));
      const personalId = links[0]?.companyId;
      assert.ok(personalId);
      assert.equal(links[0]?.administrator, true);
      await db.insert(addressBookCompanyShare).values({ entryId: entry.id, companyId: personalId });

      const deletedUser = await app.inject({
        method: "DELETE",
        url: `/users/${person.user.id}`,
        headers: auth(adminToken),
      });
      assert.equal(deletedUser.statusCode, 204);
      assert.equal(await userById(person.user.id), null);
      const dropped = await app.inject({
        method: "DELETE",
        url: `/companies/${personalId}`,
        headers: auth(adminToken),
      });
      assert.equal(dropped.statusCode, 204);
    } finally {
      if (companyId) {
        await app.inject({ method: "DELETE", url: `/companies/${companyId}`, headers: auth(adminToken) });
      }
      if (await userById(person.user.id)) {
        await removeUser(person.user.id);
      }
    }
  });
});

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function companyNamed(name: string) {
  const rows = await db.select({ id: company.id }).from(company).where(eq(company.name, name)).limit(1);
  return rows[0] ?? null;
}

async function companyById(id: string) {
  const rows = await db.select({ id: company.id }).from(company).where(eq(company.id, id)).limit(1);
  return rows[0] ?? null;
}

async function facilityById(id: string) {
  const rows = await db.select({ id: facility.id }).from(facility).where(eq(facility.id, id)).limit(1);
  return rows[0] ?? null;
}

async function userById(id: string) {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  return rows[0] ?? null;
}

async function removeUser(userId: string): Promise<void> {
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
