import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  defaultGuidanceTimingPrefs,
  normalizeGuidanceTimingPrefs,
  parseGuidanceTimingPrefs,
  type GuidanceTimingPrefs,
} from "./guidanceTimingPrefsLogic";

export type { GuidanceTimingPrefs } from "./guidanceTimingPrefsLogic";
export {
  announceLeadRange,
  defaultGuidanceTimingPrefs,
  normalizeGuidanceTimingPrefs,
  parseGuidanceTimingFields,
  parseGuidanceTimingPrefs,
  stepAdvanceRange,
} from "./guidanceTimingPrefsLogic";

const storageKey = "groundops.guidanceTiming";

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

let prefs: GuidanceTimingPrefs = defaultGuidanceTimingPrefs;
const listeners = new Set<() => void>();
let loadStarted = false;

export function getGuidanceTimingPrefs(): GuidanceTimingPrefs {
  return prefs;
}

export function subscribeGuidanceTimingPrefs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export async function ensureGuidanceTimingPrefsLoaded(): Promise<GuidanceTimingPrefs> {
  if (loadStarted) {
    return prefs;
  }
  loadStarted = true;
  const raw = await readRaw();
  const next = parseGuidanceTimingPrefs(raw) ?? defaultGuidanceTimingPrefs;
  setPrefs(next);
  return prefs;
}

export async function saveGuidanceTimingPrefs(next: GuidanceTimingPrefs): Promise<GuidanceTimingPrefs> {
  const normalized = normalizeGuidanceTimingPrefs(next);
  await writeRaw(JSON.stringify(normalized));
  setPrefs(normalized);
  return prefs;
}

function setPrefs(next: GuidanceTimingPrefs): void {
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
