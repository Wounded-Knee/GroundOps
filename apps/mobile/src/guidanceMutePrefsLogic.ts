export type GuidanceMutePrefs = {
  muted: boolean;
};

export const defaultGuidanceMutePrefs: GuidanceMutePrefs = {
  muted: false,
};

export function parseGuidanceMutePrefs(raw: string | null): GuidanceMutePrefs | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GuidanceMutePrefs>;
    if (typeof parsed.muted !== "boolean") {
      return null;
    }
    return normalizeGuidanceMutePrefs({ muted: parsed.muted });
  } catch {
    return null;
  }
}

export function normalizeGuidanceMutePrefs(input: GuidanceMutePrefs): GuidanceMutePrefs {
  return { muted: input.muted === true };
}

export function serializeGuidanceMutePrefs(prefs: GuidanceMutePrefs): string {
  return JSON.stringify(normalizeGuidanceMutePrefs(prefs));
}
