/** Minutes before departure when the navigation countdown appears. `null` is Off. */
export const countdownLeadOptions = [null, 15, 30, 45, 60, 120] as const;

export type CountdownLeadMinutes = (typeof countdownLeadOptions)[number];

export const defaultCountdownLeadMinutes: CountdownLeadMinutes = 30;

export function formatCountdownLead(leadMinutes: CountdownLeadMinutes): string {
  return leadMinutes === null ? "Off" : String(leadMinutes);
}

export const countdownLeadRangeLabel = countdownLeadOptions.map((option) => formatCountdownLead(option)).join(", ");

export function countdownLeadIndex(leadMinutes: CountdownLeadMinutes): number {
  const index = countdownLeadOptions.indexOf(leadMinutes);
  return index < 0 ? countdownLeadOptions.indexOf(defaultCountdownLeadMinutes) : index;
}

export function countdownLeadFromIndex(index: number): CountdownLeadMinutes {
  const snapped = countdownLeadOptions[Math.round(index)];
  return snapped === undefined ? defaultCountdownLeadMinutes : snapped;
}

export function isCountdownLeadMinutes(value: unknown): value is CountdownLeadMinutes {
  return value === null || value === 15 || value === 30 || value === 45 || value === 60 || value === 120;
}

export function normalizeCountdownLeadMinutes(value: number | null): CountdownLeadMinutes {
  return isCountdownLeadMinutes(value) ? value : defaultCountdownLeadMinutes;
}

/** `undefined` means the stored value could not be read. `null` means Off. */
export function parseCountdownLeadMinutes(raw: string | null): CountdownLeadMinutes | undefined {
  if (raw === null || raw.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { leadMinutes?: unknown };
    if (!isCountdownLeadMinutes(parsed.leadMinutes)) {
      return undefined;
    }
    return parsed.leadMinutes;
  } catch {
    return undefined;
  }
}

export function serializeCountdownLeadMinutes(leadMinutes: CountdownLeadMinutes): string {
  return JSON.stringify({ leadMinutes: normalizeCountdownLeadMinutes(leadMinutes) });
}
