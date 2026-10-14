import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { availabilityCheckInDue } from "./availability";
import { checkInAvailability } from "./availabilityClient";
import { resolveApiUrl } from "./apiUrl";
import { readStoredSession } from "./sessionStore";

const lastCheckInKey = "groundops.lastAvailabilityCheckIn";

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Stores a successful check-in so a later background wake can skip until three minutes have passed. */
export async function recordAvailabilityCheckIn(at: number): Promise<void> {
  await writeRaw(lastCheckInKey, String(at));
}

/**
 * Posts a check-in when a session exists and the last success is at least three minutes old.
 * A rejected session stays stored. The server ignores a check-in while the choice is false.
 */
export async function checkInAvailabilityIfDue(now = Date.now()): Promise<void> {
  const token = await readStoredSession();
  if (!token) {
    return;
  }
  const lastSentAt = await readLastCheckIn();
  if (!availabilityCheckInDue(lastSentAt, now)) {
    return;
  }
  const result = await checkInAvailability(resolveApiUrl(), token);
  if (typeof result === "string") {
    return;
  }
  await recordAvailabilityCheckIn(now);
}

async function readLastCheckIn(): Promise<number | null> {
  const raw = await readRaw(lastCheckInKey);
  if (!raw) {
    return null;
  }
  const at = Number(raw);
  if (!Number.isFinite(at)) {
    return null;
  }
  return at;
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return webStorage().getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    webStorage().setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

function webStorage(): WebStorage {
  const storage = (globalThis as { localStorage?: WebStorage }).localStorage;
  if (!storage) {
    throw new Error("Could not reach local storage.");
  }
  return storage;
}
