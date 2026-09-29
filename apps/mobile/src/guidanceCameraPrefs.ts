import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  defaultGuidanceCameraPrefs,
  normalizeGuidanceCameraPrefs,
  parseGuidanceCameraPrefs,
  type GuidanceCameraPrefs,
} from "./guidanceCameraPrefsLogic";

export type { GuidanceCameraPrefs } from "./guidanceCameraPrefsLogic";
export {
  defaultGuidanceCameraPrefs,
  guidanceTiltRange,
  guidanceZoomRange,
  normalizeGuidanceCameraPrefs,
  parseGuidanceCameraFields,
  parseGuidanceCameraPrefs,
} from "./guidanceCameraPrefsLogic";

const storageKey = "groundops.guidanceCamera";

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

let prefs: GuidanceCameraPrefs = defaultGuidanceCameraPrefs;
const listeners = new Set<() => void>();
let loadStarted = false;

export function getGuidanceCameraPrefs(): GuidanceCameraPrefs {
  return prefs;
}

export function subscribeGuidanceCameraPrefs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export async function ensureGuidanceCameraPrefsLoaded(): Promise<GuidanceCameraPrefs> {
  if (loadStarted) {
    return prefs;
  }
  loadStarted = true;
  const raw = await readRaw();
  const next = parseGuidanceCameraPrefs(raw) ?? defaultGuidanceCameraPrefs;
  setPrefs(next);
  return prefs;
}

export async function saveGuidanceCameraPrefs(next: GuidanceCameraPrefs): Promise<GuidanceCameraPrefs> {
  const normalized = normalizeGuidanceCameraPrefs(next);
  await writeRaw(JSON.stringify(normalized));
  setPrefs(normalized);
  return prefs;
}

function setPrefs(next: GuidanceCameraPrefs): void {
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
