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
  overlay: "rgba(0,0,0,0.55)",
  inputDisabled: "#2a2a2a",
};

export function colorsForScheme(scheme: ThemeScheme): ThemeColors {
  return scheme === "dark" ? darkColors : lightColors;
}
