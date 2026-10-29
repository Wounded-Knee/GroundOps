import type { ActivityResponse, AvailabilityResponse, Tariff } from "@groundops/contracts";
import type { AddressBookResponse } from "@groundops/contracts";
import { localDatabase } from "./localDatabase";

const addressBookKind = "address-book";
const activityKind = "activity";
const tariffKind = "tariff";
const availabilityKind = "availability";

export async function readAddressBookCache(userId: string): Promise<AddressBookResponse | null> {
  return readKind(userId, addressBookKind, isAddressBook);
}

export async function writeAddressBookCache(userId: string, value: AddressBookResponse): Promise<void> {
  await writeKind(userId, addressBookKind, value);
}

export async function readActivityCache(userId: string): Promise<ActivityResponse | null> {
  return readKind(userId, activityKind, isActivity);
}

export async function writeActivityCache(userId: string, value: ActivityResponse): Promise<void> {
  await writeKind(userId, activityKind, value);
}

export async function readTariffCache(userId: string): Promise<Tariff | null> {
  return readKind(userId, tariffKind, isTariff);
}

export async function writeTariffCache(userId: string, value: Tariff): Promise<void> {
  await writeKind(userId, tariffKind, value);
}

export async function readAvailabilityCache(userId: string): Promise<AvailabilityResponse | null> {
  return readKind(userId, availabilityKind, isAvailability);
}

export async function writeAvailabilityCache(userId: string, value: AvailabilityResponse): Promise<void> {
  await writeKind(userId, availabilityKind, value);
}

async function readKind<T>(userId: string, kind: string, parse: (value: unknown) => T | null): Promise<T | null> {
  const db = await localDatabase();
  const rows = await db.getAllAsync<{ payload: string }>(
    "SELECT payload FROM read_cache WHERE user_id = ? AND kind = ?",
    userId,
    kind,
  );
  const payload = rows[0]?.payload;
  if (!payload) {
    return null;
  }
  try {
    return parse(JSON.parse(payload) as unknown);
  } catch {
    return null;
  }
}

async function writeKind(userId: string, kind: string, value: unknown): Promise<void> {
  const db = await localDatabase();
  await db.runAsync(
    "INSERT INTO read_cache (user_id, kind, payload) VALUES (?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET payload = excluded.payload",
    userId,
    kind,
    JSON.stringify(value),
  );
}

function isAddressBook(value: unknown): AddressBookResponse | null {
  if (!isRecord(value) || !Array.isArray(value.entries) || !Array.isArray(value.phoneStars)) {
    return null;
  }
  if (typeof value.canShareWithCompany !== "boolean" || typeof value.canShareWithPlatform !== "boolean") {
    return null;
  }
  return value as AddressBookResponse;
}

function isActivity(value: unknown): ActivityResponse | null {
  if (!isRecord(value) || typeof value.asOf !== "string") {
    return null;
  }
  return value as ActivityResponse;
}

function isTariff(value: unknown): Tariff | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!Number.isInteger(value.flagCents) || !Number.isInteger(value.perMileCents) || !Number.isInteger(value.perWaitMinuteCents)) {
    return null;
  }
  return value as Tariff;
}

function isAvailability(value: unknown): AvailabilityResponse | null {
  if (!isRecord(value) || typeof value.asOf !== "string") {
    return null;
  }
  if (typeof value.available !== "boolean" || typeof value.current !== "boolean") {
    return null;
  }
  return value as AvailabilityResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
