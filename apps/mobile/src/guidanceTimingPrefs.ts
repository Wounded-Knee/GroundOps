import { readSecureString, writeSecureString } from "./secureString";
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
  resumeTravelRange,
  stepAdvanceRange,
} from "./guidanceTimingPrefsLogic";

const storageKey = "groundops.guidanceTiming";

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

function readRaw(): Promise<string | null> {
  return readSecureString(storageKey);
}

function writeRaw(value: string): Promise<void> {
  return writeSecureString(storageKey, value);
}
