import { readSecureString, writeSecureString } from "./secureString";
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

function readRaw(): Promise<string | null> {
  return readSecureString(storageKey);
}

function writeRaw(value: string): Promise<void> {
  return writeSecureString(storageKey, value);
}
