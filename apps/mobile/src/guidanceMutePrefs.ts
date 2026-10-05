import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  defaultGuidanceMutePrefs,
  normalizeGuidanceMutePrefs,
  parseGuidanceMutePrefs,
  serializeGuidanceMutePrefs,
  type GuidanceMutePrefs,
} from "./guidanceMutePrefsLogic";

export type { GuidanceMutePrefs } from "./guidanceMutePrefsLogic";
export {
  defaultGuidanceMutePrefs,
  normalizeGuidanceMutePrefs,
  parseGuidanceMutePrefs,
  serializeGuidanceMutePrefs,
} from "./guidanceMutePrefsLogic";

const storageKey = "groundops.guidanceMute";

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

let prefs: GuidanceMutePrefs = defaultGuidanceMutePrefs;
const listeners = new Set<() => void>();
let loadStarted = false;

export function getGuidanceMutePrefs(): GuidanceMutePrefs {
  return prefs;
}

export function subscribeGuidanceMutePrefs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export async function ensureGuidanceMutePrefsLoaded(): Promise<GuidanceMutePrefs> {
  if (loadStarted) {
    return prefs;
  }
  loadStarted = true;
  const raw = await readRaw();
  const next = parseGuidanceMutePrefs(raw) ?? defaultGuidanceMutePrefs;
  setPrefs(next);
  return prefs;
}

export async function saveGuidanceMutePrefs(next: GuidanceMutePrefs): Promise<GuidanceMutePrefs> {
  const normalized = normalizeGuidanceMutePrefs(next);
  await writeRaw(serializeGuidanceMutePrefs(normalized));
  setPrefs(normalized);
  return prefs;
}

function setPrefs(next: GuidanceMutePrefs): void {
  prefs = next;
  for (const listener of listeners) {
    listener();
  }
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === "web") {
    return webStorage().getItem(storageKey);
  }
  return SecureStore.getItemAsync(storageKey);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === "web") {
    webStorage().setItem(storageKey, value);
    return;
  }
  await SecureStore.setItemAsync(storageKey, value);
}

function webStorage(): WebStorage {
  const storage = (globalThis as { localStorage?: WebStorage }).localStorage;
  if (!storage) {
    throw new Error("Could not reach local storage.");
  }
  return storage;
}
