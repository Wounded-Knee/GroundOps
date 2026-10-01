export type AppearancePreference = "light" | "dark" | "system";

export const defaultAppearancePreference: AppearancePreference = "system";

export function parseAppearancePreference(raw: string | null): AppearancePreference | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { preference?: unknown };
    if (
      parsed.preference === "light" ||
      parsed.preference === "dark" ||
      parsed.preference === "system"
    ) {
      return parsed.preference;
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeAppearancePreference(
  preference: AppearancePreference,
): AppearancePreference {
  if (preference === "light" || preference === "dark" || preference === "system") {
    return preference;
  }
  return defaultAppearancePreference;
}

export function serializeAppearancePreference(preference: AppearancePreference): string {
  return JSON.stringify({ preference: normalizeAppearancePreference(preference) });
}
