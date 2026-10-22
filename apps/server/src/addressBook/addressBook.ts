import type {
  AddressBookEntry,
  AddressBookEntryPatch,
  AddressBookEntryWrite,
  AddressBookResponse,
  PhoneAddressStar,
  User,
} from "@groundops/contracts";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ensureDriver } from "../calendar/calendar.js";
import { db } from "../db.js";
import { addressBookEntry, addressBookPhoneStar } from "../schema.js";

export async function readAddressBook(person: User): Promise<AddressBookResponse> {
  const author = await ensureDriver(person);
  const entries = await db
    .select()
    .from(addressBookEntry)
    .where(eq(addressBookEntry.driverId, author.id))
    .orderBy(
      desc(addressBookEntry.favorite),
      sql`coalesce(nullif(${addressBookEntry.nickname}, ''), nullif(${addressBookEntry.placeName}, ''), ${addressBookEntry.label})`,
      asc(addressBookEntry.id),
    );
  const phoneStars = await db
    .select()
    .from(addressBookPhoneStar)
    .where(eq(addressBookPhoneStar.driverId, author.id))
    .orderBy(asc(addressBookPhoneStar.contactId), asc(addressBookPhoneStar.addressId));
  return {
    entries: entries.map(presentEntry),
    phoneStars: phoneStars.map(presentStar),
  };
}

export async function createAddressBookEntry(
  person: User,
  input: AddressBookEntryWrite,
): Promise<AddressBookEntry | "invalid"> {
  const nickname = input.nickname.trim();
  const placeName = input.placeName.trim();
  const label = input.label.trim();
  if (label.length === 0 || !coordinateOk(input.latitude, input.longitude)) {
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
  return presentEntry(created);
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
  if (label !== undefined && (label.length === 0 || latitude === undefined || longitude === undefined || !coordinateOk(latitude, longitude))) {
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
  return presentEntry(updated);
}

export async function deleteAddressBookEntry(person: User, id: string): Promise<"ok" | "missing"> {
  const author = await ensureDriver(person);
  const removed = await db
    .delete(addressBookEntry)
    .where(and(eq(addressBookEntry.id, id), eq(addressBookEntry.driverId, author.id)))
    .returning({ id: addressBookEntry.id });
  return removed.length === 0 ? "missing" : "ok";
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

function presentEntry(row: typeof addressBookEntry.$inferSelect): AddressBookEntry {
  return {
    id: row.id,
    nickname: row.nickname,
    placeName: row.placeName,
    label: row.label,
    latitude: row.latitude,
    longitude: row.longitude,
    favorite: row.favorite,
  };
}

function presentStar(row: typeof addressBookPhoneStar.$inferSelect): PhoneAddressStar {
  return { contactId: row.contactId, addressId: row.addressId };
}

function coordinateOk(latitude: number, longitude: number): boolean {
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}
