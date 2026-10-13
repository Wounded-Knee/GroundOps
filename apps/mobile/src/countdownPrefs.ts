import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  defaultCountdownLeadMinutes,
  normalizeCountdownLeadMinutes,
  parseCountdownLeadMinutes,
  serializeCountdownLeadMinutes,
  type CountdownLeadMinutes,
} from "./countdownPrefsLogic";

export type { CountdownLeadMinutes } from "./countdownPrefsLogic";
export {
  countdownLeadFromIndex,
  countdownLeadIndex,
  countdownLeadOptions,
  countdownLeadRangeLabel,
  defaultCountdownLeadMinutes,
  formatCountdownLead,
  isCountdownLeadMinutes,
  normalizeCountdownLeadMinutes,
  parseCountdownLeadMinutes,
  serializeCountdownLeadMinutes,
} from "./countdownPrefsLogic";

const storageKey = "groundops.countdownLead";

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

let leadMinutes: CountdownLeadMinutes = defaultCountdownLeadMinutes;
const listeners = new Set<() => void>();
let loadStarted = false;

export function getCountdownLeadMinutes(): CountdownLeadMinutes {
  return leadMinutes;
}

export function subscribeCountdownLeadMinutes(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export async function ensureCountdownLeadMinutesLoaded(): Promise<CountdownLeadMinutes> {
  if (loadStarted) {
    return leadMinutes;
  }
  loadStarted = true;
  const raw = await readRaw();
  const next = parseCountdownLeadMinutes(raw);
  setLeadMinutes(next === undefined ? defaultCountdownLeadMinutes : next);
  return leadMinutes;
}

export async function saveCountdownLeadMinutes(next: CountdownLeadMinutes): Promise<CountdownLeadMinutes> {
  const normalized = normalizeCountdownLeadMinutes(next);
  setLeadMinutes(normalized);
  await writeRaw(serializeCountdownLeadMinutes(normalized));
  return leadMinutes;
}

function setLeadMinutes(next: CountdownLeadMinutes): void {
  leadMinutes = next;
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
