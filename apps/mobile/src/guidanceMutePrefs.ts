import { readSecureString, writeSecureString } from "./secureString";
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

function readRaw(): Promise<string | null> {
  return readSecureString(storageKey);
}

function writeRaw(value: string): Promise<void> {
  return writeSecureString(storageKey, value);
}
