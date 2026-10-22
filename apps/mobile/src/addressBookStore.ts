import type { AddressBookEntry, PhoneAddressStar, PlaceSuggestion } from "@groundops/contracts";
import { Platform } from "react-native";
import {
  createAddressBookEntry,
  deleteAddressBookEntry,
  patchAddressBookEntry,
  readAddressBook,
  starPhoneAddress,
  unstarPhoneAddress,
  type AddressBookFailure,
} from "./addressBookClient";
import { samePlace, sortAddressEntries } from "./addressBookMatch";
import type { DevicePostalAddress } from "./phoneAddress";
import { phoneContactsAccess, readPostalAddresses, requestPhoneContactsAccess } from "./phoneContacts";

export type AddressBookSnapshot = {
  entries: AddressBookEntry[];
  phoneStars: PhoneAddressStar[];
  phones: DevicePostalAddress[];
  phoneAccess: "unknown" | "granted" | "denied" | "unavailable";
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
  const task = readAddressBook(apiUrl, token).then((result) => {
    if (inflight?.task === task) {
      inflight = null;
    }
    if (seen !== epoch) {
      return "ok" as const;
    }
    if (typeof result === "string") {
      return result;
    }
    loadedFor = token;
    publish({
      entries: mergeEntries(result.entries),
      phoneStars: mergeStars(result.phoneStars),
    });
    removedEntryIds.clear();
    removedStarKeys.clear();
    return "ok" as const;
  });
  inflight = { token, task };
  return task;
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
  if (snapshot.entries.some((entry) => samePlace(entry, place))) {
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
  return { entries: [], phoneStars: [], phones: [], phoneAccess: "unknown" };
}
