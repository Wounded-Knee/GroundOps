import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  defaultVisualAlertPrefs,
  normalizeVisualAlertPrefs,
  parseVisualAlertPrefs,
  serializeVisualAlertPrefs,
  type VisualAlertPrefs,
} from "./visualAlertPrefsLogic";

export type { VisualAlertPrefs } from "./visualAlertPrefsLogic";
export {
  defaultVisualAlertPrefs,
  normalizeHexColor,
  normalizeVisualAlertPrefs,
  parseVisualAlertPrefs,
  serializeVisualAlertPrefs,
  visualAlertPresets,
} from "./visualAlertPrefsLogic";

const storageKey = "groundops.visualAlert";

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

let prefs: VisualAlertPrefs = defaultVisualAlertPrefs;
const listeners = new Set<() => void>();
let loadStarted = false;

export function getVisualAlertPrefs(): VisualAlertPrefs {
  return prefs;
}

export function subscribeVisualAlertPrefs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export async function ensureVisualAlertPrefsLoaded(): Promise<VisualAlertPrefs> {
  if (loadStarted) {
    return prefs;
  }
  loadStarted = true;
  const raw = await readRaw();
  const next = parseVisualAlertPrefs(raw) ?? defaultVisualAlertPrefs;
  setPrefs(next);
  return prefs;
}

export async function saveVisualAlertPrefs(next: VisualAlertPrefs): Promise<VisualAlertPrefs> {
  const normalized = normalizeVisualAlertPrefs(next);
  setPrefs(normalized);
  await writeRaw(serializeVisualAlertPrefs(normalized));
  return prefs;
}

function setPrefs(next: VisualAlertPrefs): void {
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
