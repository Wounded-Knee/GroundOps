import type {
  AddressBookEntry,
  AddressBookEntryPatch,
  AddressBookEntryWrite,
  AddressBookResponse,
  PhoneAddressStar,
  User,
} from "@groundops/contracts";
import { and, asc, desc, eq, exists, inArray, or, sql } from "drizzle-orm";
import { ensureDriver, type DriverDb } from "../identity/driver.js";
import { db } from "../db.js";
import { addressBookCompanyShare, addressBookEntry, addressBookPhoneStar, driverCompany } from "../schema.js";

type EntryRow = typeof addressBookEntry.$inferSelect;
type ShareFailure = "missing" | "forbidden";

export async function readAddressBook(person: User): Promise<AddressBookResponse> {
  const author = await ensureDriver(person);
  const [memberIds, adminIds] = await Promise.all([
    companyIds(author.id, false),
    companyIds(author.id, true),
  ]);
  const access = [
    eq(addressBookEntry.driverId, author.id),
    eq(addressBookEntry.platformShared, true),
  ];
  if (memberIds.length > 0) {
    access.push(
      exists(
        db
          .select({ entryId: addressBookCompanyShare.entryId })
          .from(addressBookCompanyShare)
          .where(
            and(
              eq(addressBookCompanyShare.entryId, addressBookEntry.id),
              inArray(addressBookCompanyShare.companyId, memberIds),
            ),
          ),
      ),
    );
  }
  const entries = await db
    .select()
    .from(addressBookEntry)
    .where(or(...access))
    .orderBy(
      desc(addressBookEntry.favorite),
      sql`coalesce(nullif(${addressBookEntry.nickname}, ''), nullif(${addressBookEntry.placeName}, ''), ${addressBookEntry.label})`,
      asc(addressBookEntry.id),
    );
  const sharedIds = await companySharedEntryIds(
    entries.map((entry) => entry.id),
    adminIds,
  );
  const phoneStars = await db
    .select()
    .from(addressBookPhoneStar)
    .where(eq(addressBookPhoneStar.driverId, author.id))
    .orderBy(asc(addressBookPhoneStar.contactId), asc(addressBookPhoneStar.addressId));
  return {
    entries: entries.map((entry) =>
      presentEntry(entry, {
        owned: entry.driverId === author.id,
        companyShared: sharedIds.has(entry.id),
      }),
    ),
    phoneStars: phoneStars.map(presentStar),
    canShareWithCompany: adminIds.length > 0,
    canShareWithPlatform: person.platformAdministrator,
  };
}

export async function createAddressBookEntry(
  person: User,
  input: AddressBookEntryWrite,
): Promise<AddressBookEntry | "invalid"> {
  const nickname = input.nickname.trim();
  const placeName = input.placeName.trim();
  const label = input.label.trim();
  if (label.length === 0) {
    return "invalid";
  }
  const author = await ensureDriver(person);
  const [created] = await db
    .insert(addressBookEntry)
    .values({
      driverId: author.id,
      nickname,
      placeName,
      label,
      latitude: input.latitude,
      longitude: input.longitude,
    })
    .returning();
  if (!created) {
    return "invalid";
  }
  return presentForOwner(created, author.id);
}

export async function updateAddressBookEntry(
  person: User,
  id: string,
  patch: AddressBookEntryPatch,
): Promise<AddressBookEntry | "invalid" | "missing"> {
  const nickname = patch.nickname === undefined ? undefined : patch.nickname.trim();
  const placeName = patch.placeName === undefined ? undefined : patch.placeName.trim();
  const label = patch.label === undefined ? undefined : patch.label.trim();
  const latitude = patch.latitude;
  const longitude = patch.longitude;
  const moves = patch.label !== undefined || latitude !== undefined || longitude !== undefined;
  if (moves && (label === undefined || latitude === undefined || longitude === undefined)) {
    return "invalid";
  }
  if (label !== undefined && (label.length === 0 || latitude === undefined || longitude === undefined)) {
    return "invalid";
  }
  if (nickname === undefined && placeName === undefined && label === undefined && patch.favorite === undefined) {
    return "invalid";
  }
  const author = await ensureDriver(person);
  const next: {
    nickname?: string;
    placeName?: string;
    label?: string;
    latitude?: number;
    longitude?: number;
    favorite?: boolean;
  } = {};
  if (nickname !== undefined) {
    next.nickname = nickname;
  }
  if (placeName !== undefined) {
    next.placeName = placeName;
  }
  if (label !== undefined && latitude !== undefined && longitude !== undefined) {
    next.label = label;
    next.latitude = latitude;
    next.longitude = longitude;
  }
  if (patch.favorite !== undefined) {
    next.favorite = patch.favorite;
  }
  const [updated] = await db
    .update(addressBookEntry)
    .set(next)
    .where(and(eq(addressBookEntry.id, id), eq(addressBookEntry.driverId, author.id)))
    .returning();
  if (!updated) {
    return "missing";
  }
  return presentForOwner(updated, author.id);
}

export async function deleteAddressBookEntry(person: User, id: string): Promise<"ok" | "missing"> {
  const author = await ensureDriver(person);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: addressBookEntry.id })
      .from(addressBookEntry)
      .where(and(eq(addressBookEntry.id, id), eq(addressBookEntry.driverId, author.id)))
      .limit(1);
    if (!existing[0]) {
      return "missing";
    }
    await tx.delete(addressBookCompanyShare).where(eq(addressBookCompanyShare.entryId, id));
    await tx.delete(addressBookEntry).where(eq(addressBookEntry.id, id));
    return "ok";
  });
}

/** Grants the entry to every company the owner currently administers. */
export async function shareAddressBookEntryWithCompany(person: User, id: string): Promise<AddressBookEntry | ShareFailure> {
  return setCompanyShare(person, id, true);
}

/** Removes grants for companies the owner currently administers. */
export async function unshareAddressBookEntryWithCompany(person: User, id: string): Promise<AddressBookEntry | ShareFailure> {
  return setCompanyShare(person, id, false);
}

/** Makes the owner's entry readable by every signed-in user. */
export async function shareAddressBookEntryWithPlatform(person: User, id: string): Promise<AddressBookEntry | ShareFailure> {
  return setPlatformShare(person, id, true);
}

/** Clears platform access. The row stays with the owner. */
export async function unshareAddressBookEntryWithPlatform(person: User, id: string): Promise<AddressBookEntry | ShareFailure> {
  return setPlatformShare(person, id, false);
}

/** Inserts the star. A repeat star leaves the existing row in place. */
export async function starPhoneAddress(person: User, star: PhoneAddressStar): Promise<"ok" | "invalid"> {
  const contactId = star.contactId.trim();
  const addressId = star.addressId.trim();
  if (contactId.length === 0 || addressId.length === 0) {
    return "invalid";
  }
  const author = await ensureDriver(person);
  await db
    .insert(addressBookPhoneStar)
    .values({ driverId: author.id, contactId, addressId })
    .onConflictDoNothing();
  return "ok";
}

/** Removes the star. A missing star is already the desired state. */
export async function unstarPhoneAddress(person: User, star: PhoneAddressStar): Promise<"ok" | "invalid"> {
  const contactId = star.contactId.trim();
  const addressId = star.addressId.trim();
  if (contactId.length === 0 || addressId.length === 0) {
    return "invalid";
  }
  const author = await ensureDriver(person);
  await db
    .delete(addressBookPhoneStar)
    .where(
      and(
        eq(addressBookPhoneStar.driverId, author.id),
        eq(addressBookPhoneStar.contactId, contactId),
        eq(addressBookPhoneStar.addressId, addressId),
      ),
    );
  return "ok";
}

async function setCompanyShare(person: User, id: string, shared: boolean): Promise<AddressBookEntry | ShareFailure> {
  const owned = await ownedEntry(person, id);
  if (owned === "missing") {
    return "missing";
  }
  const companyIdsForAdmin = await companyIds(owned.driverId, true);
  if (companyIdsForAdmin.length === 0) {
    return "forbidden";
  }
  if (shared) {
    await db
      .insert(addressBookCompanyShare)
      .values(companyIdsForAdmin.map((companyId) => ({ entryId: id, companyId })))
      .onConflictDoNothing();
  } else {
    await db
      .delete(addressBookCompanyShare)
      .where(and(eq(addressBookCompanyShare.entryId, id), inArray(addressBookCompanyShare.companyId, companyIdsForAdmin)));
  }
  return presentForOwner(owned.row, owned.driverId);
}

async function setPlatformShare(person: User, id: string, shared: boolean): Promise<AddressBookEntry | ShareFailure> {
  const owned = await ownedEntry(person, id);
  if (owned === "missing") {
    return "missing";
  }
  if (!person.platformAdministrator) {
    return "forbidden";
  }
  const [updated] = await db
    .update(addressBookEntry)
    .set({ platformShared: shared })
    .where(eq(addressBookEntry.id, id))
    .returning();
  if (!updated) {
    return "missing";
  }
  return presentForOwner(updated, owned.driverId);
}

async function ownedEntry(person: User, id: string): Promise<{ driverId: string; row: EntryRow } | "missing"> {
  const author = await ensureDriver(person);
  const [row] = await db
    .select()
    .from(addressBookEntry)
    .where(and(eq(addressBookEntry.id, id), eq(addressBookEntry.driverId, author.id)))
    .limit(1);
  if (!row) {
    return "missing";
  }
  return { driverId: author.id, row };
}

async function companyIds(driverId: string, administratorsOnly: boolean): Promise<string[]> {
  const rows = await db
    .select({ companyId: driverCompany.companyId })
    .from(driverCompany)
    .where(
      administratorsOnly
        ? and(eq(driverCompany.driverId, driverId), eq(driverCompany.administrator, true))
        : eq(driverCompany.driverId, driverId),
    );
  return rows.map((row) => row.companyId);
}

async function companySharedEntryIds(entryIds: string[], adminIds: string[]): Promise<Set<string>> {
  if (entryIds.length === 0 || adminIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ entryId: addressBookCompanyShare.entryId })
    .from(addressBookCompanyShare)
    .where(and(inArray(addressBookCompanyShare.entryId, entryIds), inArray(addressBookCompanyShare.companyId, adminIds)));
  return new Set(rows.map((row) => row.entryId));
}

async function presentForOwner(row: EntryRow, driverId: string): Promise<AddressBookEntry> {
  const adminIds = await companyIds(driverId, true);
  const sharedIds = await companySharedEntryIds([row.id], adminIds);
  return presentEntry(row, { owned: true, companyShared: sharedIds.has(row.id) });
}

function presentEntry(row: EntryRow, flags: { owned: boolean; companyShared: boolean }): AddressBookEntry {
  return {
    id: row.id,
    nickname: row.nickname,
    placeName: row.placeName,
    label: row.label,
    latitude: row.latitude,
    longitude: row.longitude,
    favorite: row.favorite,
    owned: flags.owned,
    companyShared: flags.companyShared,
    platformShared: row.platformShared,
  };
}

/** Deletes saved places, company grants, and phone stars for one driver. */
export async function deleteOwnedByDriver(tx: DriverDb, driverId: string): Promise<void> {
  const entries = await tx
    .select({ id: addressBookEntry.id })
    .from(addressBookEntry)
    .where(eq(addressBookEntry.driverId, driverId));
  if (entries.length > 0) {
    await tx.delete(addressBookCompanyShare).where(
      inArray(
        addressBookCompanyShare.entryId,
        entries.map((entry) => entry.id),
      ),
    );
  }
  await tx.delete(addressBookEntry).where(eq(addressBookEntry.driverId, driverId));
  await tx.delete(addressBookPhoneStar).where(eq(addressBookPhoneStar.driverId, driverId));
}

function presentStar(row: typeof addressBookPhoneStar.$inferSelect): PhoneAddressStar {
  return { contactId: row.contactId, addressId: row.addressId };
}
