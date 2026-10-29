import type { AddressBookEntry, PhoneAddressStar, PlaceSuggestion } from "@groundops/contracts";
import { Platform } from "react-native";
import {
  createAddressBookEntry,
  deleteAddressBookEntry,
  patchAddressBookEntry,
  readAddressBook,
  setCompanyShare,
  setPlatformShare,
  starPhoneAddress,
  unstarPhoneAddress,
  type AddressBookFailure,
} from "./addressBookClient";
import { samePlace, sortAddressEntries } from "./addressBookMatch";
import type { DevicePostalAddress } from "./phoneAddress";
import { phoneContactsAccess, readPostalAddresses, requestPhoneContactsAccess } from "./phoneContacts";
import { readAddressBookCache, writeAddressBookCache } from "./readCache";
import { readStoredUser } from "./sessionStore";

export type AddressBookSnapshot = {
  entries: AddressBookEntry[];
  phoneStars: PhoneAddressStar[];
  phones: DevicePostalAddress[];
  phoneAccess: "unknown" | "granted" | "denied" | "unavailable";
  canShareWithCompany: boolean;
  canShareWithPlatform: boolean;
};

const listeners = new Set<() => void>();
let snapshot: AddressBookSnapshot = emptySnapshot();
let loadedFor: string | null = null;
let phonesLoaded = false;
let phoneRead: Promise<DevicePostalAddress[]> | null = null;
let inflight: { token: string; task: Promise<"ok" | AddressBookFailure> } | null = null;
let epoch = 0;
const removedEntryIds = new Set<string>();
const removedStarKeys = new Set<string>();

export function getAddressBookSnapshot(): AddressBookSnapshot {
  return snapshot;
}

export function subscribeAddressBook(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function addressBookHasLoaded(): boolean {
  return loadedFor !== null;
}

export function clearAddressBookCache(): void {
  epoch += 1;
  loadedFor = null;
  phonesLoaded = false;
  phoneRead = null;
  inflight = null;
  removedEntryIds.clear();
  removedStarKeys.clear();
  publish(emptySnapshot());
}

export async function ensureAddressBookLoaded(apiUrl: string, token: string): Promise<"ok" | AddressBookFailure> {
  if (loadedFor === token) {
    return "ok";
  }
  if (inflight?.token === token) {
    return inflight.task;
  }
  const seen = epoch;
  const task = readAddressBook(apiUrl, token).then(async (result) => {
    if (inflight?.task === task) {
      inflight = null;
    }
    if (seen !== epoch) {
      return "ok" as const;
    }
    if (typeof result === "string") {
      if (result === "unreachable") {
        const cached = await cachedAddressBook();
        if (cached && seen === epoch) {
          loadedFor = token;
          publish({
            entries: mergeEntries(cached.entries),
            phoneStars: mergeStars(cached.phoneStars),
            canShareWithCompany: cached.canShareWithCompany,
            canShareWithPlatform: cached.canShareWithPlatform,
          });
          return "ok" as const;
        }
      }
      return result;
    }
    loadedFor = token;
    publish({
      entries: mergeEntries(result.entries),
      phoneStars: mergeStars(result.phoneStars),
      canShareWithCompany: result.canShareWithCompany,
      canShareWithPlatform: result.canShareWithPlatform,
    });
    removedEntryIds.clear();
    removedStarKeys.clear();
    await rememberAddressBook(result);
    return "ok" as const;
  });
  inflight = { token, task };
  return task;
}

export async function reloadAddressBook(apiUrl: string, token: string): Promise<void> {
  const result = await readAddressBook(apiUrl, token);
  if (typeof result === "string" || epoch === 0) {
    return;
  }
  loadedFor = token;
  publish({
    entries: mergeEntries(result.entries),
    phoneStars: mergeStars(result.phoneStars),
    canShareWithCompany: result.canShareWithCompany,
    canShareWithPlatform: result.canShareWithPlatform,
  });
  removedEntryIds.clear();
  removedStarKeys.clear();
  await rememberAddressBook(result);
}

async function cachedAddressBook() {
  try {
    const user = await readStoredUser();
    return user ? await readAddressBookCache(user.id) : null;
  } catch {
    return null;
  }
}

async function rememberAddressBook(result: {
  entries: AddressBookSnapshot["entries"];
  phoneStars: AddressBookSnapshot["phoneStars"];
  canShareWithCompany: boolean;
  canShareWithPlatform: boolean;
}): Promise<void> {
  try {
    const user = await readStoredUser();
    if (user) {
      await writeAddressBookCache(user.id, result);
    }
  } catch {
    // The in-memory book is already showing. The next successful read writes the cache.
  }
}

/** Reads device addresses when permission is already granted. Does not prompt. */
export async function refreshDeviceAddresses(): Promise<void> {
  if (Platform.OS === "web") {
    phonesLoaded = true;
    publish({ phoneAccess: "unavailable", phones: [] });
    return;
  }
  const access = await phoneContactsAccess();
  if (access !== "granted") {
    phonesLoaded = false;
    publish({ phoneAccess: access, phones: [] });
    return;
  }
  await readDevicePhones();
}

/** Asks for contacts permission, then reads postal addresses. */
export async function requestDeviceAddresses(): Promise<"granted" | "denied" | "unavailable"> {
  if (Platform.OS === "web") {
    phonesLoaded = true;
    publish({ phoneAccess: "unavailable", phones: [] });
    return "unavailable";
  }
  const access = await requestPhoneContactsAccess();
  if (access !== "granted") {
    phonesLoaded = false;
    publish({ phoneAccess: access, phones: [] });
    return access;
  }
  await readDevicePhones();
  return "granted";
}

/** One contacts scan at a time. A finished scan is reused until sign-out. */
function readDevicePhones(): Promise<DevicePostalAddress[]> {
  if (phonesLoaded) {
    if (snapshot.phoneAccess !== "granted") {
      publish({ phoneAccess: "granted" });
    }
    return Promise.resolve(snapshot.phones);
  }
  if (phoneRead) {
    return phoneRead;
  }
  const task = readPostalAddresses()
    .then((phones) => {
      if (phoneRead === task) {
        phoneRead = null;
      }
      phonesLoaded = true;
      publish({ phoneAccess: "granted", phones });
      return phones;
    })
    .catch((error: unknown) => {
      if (phoneRead === task) {
        phoneRead = null;
      }
      throw error;
    });
  phoneRead = task;
  return task;
}

export async function saveChosenPlace(
  apiUrl: string,
  token: string,
  place: PlaceSuggestion,
): Promise<"ok" | "exists" | AddressBookFailure> {
  const loaded = await ensureAddressBookLoaded(apiUrl, token);
  if (loaded !== "ok") {
    return loaded;
  }
  if (snapshot.entries.some((entry) => entry.owned && samePlace(entry, place))) {
    return "exists";
  }
  const created = await createAddressBookEntry(apiUrl, token, {
    nickname: "",
    placeName: place.name.trim(),
    label: place.label,
    latitude: place.latitude,
    longitude: place.longitude,
  });
  if (typeof created === "string") {
    return created;
  }
  noteEntry(created);
  return "ok";
}

export async function saveAddressRecord(
  apiUrl: string,
  token: string,
  record: { id: string | null; nickname: string; placeName: string; place: PlaceSuggestion },
): Promise<AddressBookEntry | AddressBookFailure> {
  const body = {
    nickname: record.nickname,
    placeName: record.placeName,
    label: record.place.label,
    latitude: record.place.latitude,
    longitude: record.place.longitude,
  };
  const saved = record.id
    ? await patchAddressBookEntry(apiUrl, token, record.id, body)
    : await createAddressBookEntry(apiUrl, token, body);
  if (typeof saved !== "string") {
    noteEntry(saved);
  }
  return saved;
}

export async function setEntryFavorite(
  apiUrl: string,
  token: string,
  id: string,
  favorite: boolean,
): Promise<AddressBookEntry | AddressBookFailure> {
  const updated = await patchAddressBookEntry(apiUrl, token, id, { favorite });
  if (typeof updated !== "string") {
    noteEntry(updated);
  }
  return updated;
}

export async function setEntryCompanyShare(
  apiUrl: string,
  token: string,
  id: string,
  shared: boolean,
): Promise<AddressBookEntry | AddressBookFailure> {
  const updated = await setCompanyShare(apiUrl, token, id, shared);
  if (typeof updated !== "string") {
    noteEntry(updated);
  }
  return updated;
}

export async function setEntryPlatformShare(
  apiUrl: string,
  token: string,
  id: string,
  shared: boolean,
): Promise<AddressBookEntry | AddressBookFailure> {
  const updated = await setPlatformShare(apiUrl, token, id, shared);
  if (typeof updated !== "string") {
    noteEntry(updated);
  }
  return updated;
}

export async function removeSavedEntry(apiUrl: string, token: string, id: string): Promise<"ok" | AddressBookFailure> {
  const removed = await deleteAddressBookEntry(apiUrl, token, id);
  if (removed === "ok") {
    removedEntryIds.add(id);
    publish({ entries: snapshot.entries.filter((entry) => entry.id !== id) });
  }
  return removed;
}

export async function setPhoneStarred(
  apiUrl: string,
  token: string,
  star: PhoneAddressStar,
  starred: boolean,
): Promise<"ok" | AddressBookFailure> {
  const result = starred ? await starPhoneAddress(apiUrl, token, star) : await unstarPhoneAddress(apiUrl, token, star);
  if (result !== "ok") {
    return result;
  }
  const phoneStars = starred
    ? [...snapshot.phoneStars.filter((item) => !sameStar(item, star)), star]
    : snapshot.phoneStars.filter((item) => !sameStar(item, star));
  if (starred) {
    removedStarKeys.delete(starKey(star));
  } else {
    removedStarKeys.add(starKey(star));
  }
  publish({ phoneStars });
  return "ok";
}

function noteEntry(entry: AddressBookEntry): void {
  removedEntryIds.delete(entry.id);
  publish({ entries: sortAddressEntries([...snapshot.entries.filter((item) => item.id !== entry.id), entry]) });
}

function mergeEntries(server: AddressBookEntry[]): AddressBookEntry[] {
  const local = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  const merged = server.filter((entry) => !removedEntryIds.has(entry.id)).map((entry) => local.get(entry.id) ?? entry);
  for (const entry of snapshot.entries) {
    if (!removedEntryIds.has(entry.id) && !merged.some((item) => item.id === entry.id)) {
      merged.push(entry);
    }
  }
  return sortAddressEntries(merged);
}

function mergeStars(server: PhoneAddressStar[]): PhoneAddressStar[] {
  const merged = server.filter((star) => !removedStarKeys.has(starKey(star)) && !snapshot.phoneStars.some((local) => sameStar(local, star)));
  return [...merged, ...snapshot.phoneStars];
}

function starKey(star: PhoneAddressStar): string {
  return `${star.contactId}\n${star.addressId}`;
}

function publish(patch: Partial<AddressBookSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) {
    listener();
  }
}

function sameStar(left: PhoneAddressStar, right: PhoneAddressStar): boolean {
  return left.contactId === right.contactId && left.addressId === right.addressId;
}

function emptySnapshot(): AddressBookSnapshot {
  return { entries: [], phoneStars: [], phones: [], phoneAccess: "unknown", canShareWithCompany: false, canShareWithPlatform: false };
}
