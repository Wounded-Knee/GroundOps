import { readSecureString, writeSecureString } from "./secureString";
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

function readRaw(): Promise<string | null> {
  return readSecureString(storageKey);
}

function writeRaw(value: string): Promise<void> {
  return writeSecureString(storageKey, value);
}
