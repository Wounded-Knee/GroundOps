export type ThemeScheme = "light" | "dark";

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryText: string;
  accent: string;
  accentSoft: string;
  reposition: string;
  repositionText: string;
  overlay: string;
  inputDisabled: string;
};

export const lightColors: ThemeColors = {
  background: "#ffffff",
  surface: "#ffffff",
  surfaceMuted: "#eeeeee",
  text: "#111111",
  textSecondary: "#444444",
  textMuted: "#888888",
  border: "#cccccc",
  borderStrong: "#767676",
  primary: "#111111",
  primaryText: "#ffffff",
  accent: "#1A73E8",
  accentSoft: "#E8F0FE",
  reposition: "#D7E8D4",
  repositionText: "#1B3A1F",
  overlay: "rgba(0,0,0,0.35)",
  inputDisabled: "#f5f5f5",
};

export const darkColors: ThemeColors = {
  background: "#121212",
  surface: "#1e1e1e",
  surfaceMuted: "#2a2a2a",
  text: "#f2f2f2",
  textSecondary: "#c4c4c4",
  textMuted: "#9a9a9a",
  border: "#3a3a3a",
  borderStrong: "#5a5a5a",
  primary: "#f2f2f2",
  primaryText: "#111111",
  accent: "#1A73E8",
  accentSoft: "#1a2a40",
  reposition: "#1E3A24",
  repositionText: "#E8F5E9",
  overlay: "rgba(0,0,0,0.55)",
  inputDisabled: "#2a2a2a",
};

export function colorsForScheme(scheme: ThemeScheme): ThemeColors {
  return scheme === "dark" ? darkColors : lightColors;
}

const deadheadShade = 0.35;
const waitShade = 0.55;
const waitYellow = "#F5C400";

export type ActivitySegmentKind = "deadhead" | "passenger" | "wait";

/** Mix `amount` of `to` into `from`. `0` is `from`, `1` is `to`. */
export function mixHex(from: string, to: string, amount: number): string {
  const start = parseHex(from);
  const end = parseHex(to);
  if (!start || !end) {
    return from;
  }
  const blend = Math.min(1, Math.max(0, amount));
  const channel = (left: number, right: number) => Math.round(left + (right - left) * blend);
  return `#${toHex(channel(start.r, end.r))}${toHex(channel(start.g, end.g))}${toHex(channel(start.b, end.b))}`;
}

/** Passenger keeps the block color. Dead-head is a lighter or darker shade. Wait is yellow-tinted. */
export function activitySegmentColor(base: string, kind: ActivitySegmentKind): string {
  if (kind === "passenger") {
    return base;
  }
  if (kind === "deadhead") {
    const toward = relativeLuminance(base) > 0.5 ? "#000000" : "#ffffff";
    return mixHex(base, toward, deadheadShade);
  }
  return mixHex(base, waitYellow, waitShade);
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.startsWith("#") ? hex.slice(1) : hex;
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return null;
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function relativeLuminance(hex: string): number {
  const parsed = parseHex(hex);
  if (!parsed) {
    return 0;
  }
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(parsed.r) + 0.7152 * channel(parsed.g) + 0.0722 * channel(parsed.b);
}

/** Hex color with alpha; leaves children at full opacity when used as backgroundColor. */
export function withAlpha(hex: string, alpha: number): string {
  const raw = hex.startsWith("#") ? hex.slice(1) : hex;
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : raw;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
