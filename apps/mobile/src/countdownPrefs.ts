import { readSecureString, writeSecureString } from "./secureString";
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

function readRaw(): Promise<string | null> {
  return readSecureString(storageKey);
}

function writeRaw(value: string): Promise<void> {
  return writeSecureString(storageKey, value);
}
