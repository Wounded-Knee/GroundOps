import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  defaultAppearancePreference,
  normalizeAppearancePreference,
  parseAppearancePreference,
  serializeAppearancePreference,
  type AppearancePreference,
} from "./appearancePrefsLogic";

export type { AppearancePreference } from "./appearancePrefsLogic";
export {
  defaultAppearancePreference,
  normalizeAppearancePreference,
  parseAppearancePreference,
  serializeAppearancePreference,
} from "./appearancePrefsLogic";

const storageKey = "groundops.appearance";

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

let preference: AppearancePreference = defaultAppearancePreference;
const listeners = new Set<() => void>();
let loadStarted = false;

export function getAppearancePreference(): AppearancePreference {
  return preference;
}

export function subscribeAppearancePreference(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export async function ensureAppearancePreferenceLoaded(): Promise<AppearancePreference> {
  if (loadStarted) {
    return preference;
  }
  loadStarted = true;
  const raw = await readRaw();
  const next = parseAppearancePreference(raw) ?? defaultAppearancePreference;
  setPreference(next);
  return preference;
}

export async function saveAppearancePreference(
  next: AppearancePreference,
): Promise<AppearancePreference> {
  const normalized = normalizeAppearancePreference(next);
  setPreference(normalized);
  await writeRaw(serializeAppearancePreference(normalized));
  return preference;
}

function setPreference(next: AppearancePreference): void {
  preference = next;
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
