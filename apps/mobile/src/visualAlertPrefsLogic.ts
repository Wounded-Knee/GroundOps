export type VisualAlertPrefs = {
  enabled: boolean;
  color: string;
  intensity: number;
  brightness: number;
};

export const visualAlertPresets = [
  "#FF3B30",
  "#FF9500",
  "#FFCC00",
  "#34C759",
  "#007AFF",
  "#AF52DE",
  "#FFFFFF",
] as const;

export const defaultVisualAlertPrefs: VisualAlertPrefs = {
  enabled: false,
  color: "#FF3B30",
  intensity: 0.1,
  brightness: 0.7,
};

export function parseVisualAlertPrefs(raw: string | null): VisualAlertPrefs | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<VisualAlertPrefs>;
    if (
      typeof parsed.enabled !== "boolean" ||
      typeof parsed.color !== "string" ||
      typeof parsed.intensity !== "number" ||
      typeof parsed.brightness !== "number"
    ) {
      return null;
    }
    const color = normalizeHexColor(parsed.color);
    if (color === null) {
      return null;
    }
    return normalizeVisualAlertPrefs({
      enabled: parsed.enabled,
      color,
      intensity: parsed.intensity,
      brightness: parsed.brightness,
    });
  } catch {
    return null;
  }
}

export function normalizeVisualAlertPrefs(input: VisualAlertPrefs): VisualAlertPrefs {
  const color = normalizeHexColor(input.color) ?? defaultVisualAlertPrefs.color;
  return {
    enabled: input.enabled === true,
    color,
    intensity: clamp01(input.intensity),
    brightness: clamp01(input.brightness),
  };
}

export function serializeVisualAlertPrefs(prefs: VisualAlertPrefs): string {
  return JSON.stringify(normalizeVisualAlertPrefs(prefs));
}

/** Accept `#RGB` or `#RRGGBB` (case-insensitive); return uppercase `#RRGGBB`, or null. */
export function normalizeHexColor(raw: string): string | null {
  const trimmed = raw.trim();
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const hex = match[1];
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : hex;
  return `#${full.toUpperCase()}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
