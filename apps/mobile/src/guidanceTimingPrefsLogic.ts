import { announceLeadMeters, stepAdvanceMeters } from "./guidance";

export type GuidanceTimingPrefs = {
  announceLeadMeters: number;
  stepAdvanceMeters: number;
  /** Meters from a stop before GPS starts the next leg. 0 is off. */
  resumeTravelMeters: number;
};

export const announceLeadRange = { min: 50, max: 1000 } as const;
export const stepAdvanceRange = { min: 10, max: 100 } as const;
export const resumeTravelRange = { min: 0, max: 150 } as const;
/** Matches the arrival geofence used for GPS leave before this setting existed. */
export const defaultResumeTravelMeters = 40;

export const defaultGuidanceTimingPrefs: GuidanceTimingPrefs = {
  announceLeadMeters,
  stepAdvanceMeters,
  resumeTravelMeters: defaultResumeTravelMeters,
};

export function parseGuidanceTimingPrefs(raw: string | null): GuidanceTimingPrefs | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GuidanceTimingPrefs>;
    if (typeof parsed.announceLeadMeters !== "number" || typeof parsed.stepAdvanceMeters !== "number") {
      return null;
    }
    return normalizeGuidanceTimingPrefs({
      announceLeadMeters: parsed.announceLeadMeters,
      stepAdvanceMeters: parsed.stepAdvanceMeters,
      resumeTravelMeters:
        typeof parsed.resumeTravelMeters === "number" ? parsed.resumeTravelMeters : defaultResumeTravelMeters,
    });
  } catch {
    return null;
  }
}

export function normalizeGuidanceTimingPrefs(input: GuidanceTimingPrefs): GuidanceTimingPrefs {
  return {
    announceLeadMeters: clamp(input.announceLeadMeters, announceLeadRange.min, announceLeadRange.max),
    stepAdvanceMeters: clamp(input.stepAdvanceMeters, stepAdvanceRange.min, stepAdvanceRange.max),
    resumeTravelMeters: clamp(input.resumeTravelMeters, resumeTravelRange.min, resumeTravelRange.max),
  };
}

export function parseGuidanceTimingFields(
  announceLeadText: string,
  stepAdvanceText: string,
): GuidanceTimingPrefs | null {
  const announceLead = parseDecimal(announceLeadText);
  const stepAdvance = parseDecimal(stepAdvanceText);
  if (announceLead === null || stepAdvance === null) {
    return null;
  }
  return normalizeGuidanceTimingPrefs({
    announceLeadMeters: announceLead,
    stepAdvanceMeters: stepAdvance,
    resumeTravelMeters: defaultResumeTravelMeters,
  });
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function parseDecimal(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}
