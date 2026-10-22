import { withAlpha } from "./theme";

export const THROB_MS = 375;

/** A throb uses a fixed rim, brighter than the steady alert. */
export const throbIntensity = 0.5;
export const throbBrightness = 1;

const fadeStopCount = 8;

export type AlertSide = "left" | "right" | "all";

export type AlertEdges = {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
};

export function normalizeThrobCount(count: number): number {
  if (!Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.floor(count));
}

/** Left turns light the left, top, and bottom edges. Right turns light the right, top, and bottom. */
export function alertEdges(side: AlertSide): AlertEdges {
  if (side === "left") {
    return { top: true, bottom: true, left: true, right: false };
  }
  if (side === "right") {
    return { top: true, bottom: true, left: false, right: true };
  }
  return { top: true, bottom: true, left: true, right: true };
}

export type FadeStop = {
  r: number;
  g: number;
  b: number;
  /** 0 at the inner edge, up to `brightness` at the outer edge. */
  a: number;
  /** 0 at the outer edge, 1 at the inner edge. */
  position: number;
};

/** Quadratic rim fade shared by the in-app alert and the Android full-screen overlay. */
export function edgeFadeStops(color: string, brightness: number): FadeStop[] {
  const rgb = rgbChannels(color);
  if (!rgb || !Number.isFinite(brightness) || brightness <= 0) {
    return [];
  }
  const clamped = Math.min(1, brightness);
  return Array.from({ length: fadeStopCount }, (_, index) => {
    const t = 1 - index / (fadeStopCount - 1);
    return {
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      a: clamped * t * t,
      position: index / (fadeStopCount - 1),
    };
  });
}

export function edgeFadeGradient(
  color: string,
  brightness: number,
  direction: "to bottom" | "to top" | "to right" | "to left",
): string {
  const stops = edgeFadeStops(color, brightness).map(
    (stop) => `${withAlpha(color, stop.a)} ${stop.position * 100}%`,
  );
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

function rgbChannels(color: string): { r: number; g: number; b: number } | null {
  const raw = color.startsWith("#") ? color.slice(1) : color;
  const full = raw.length === 3 ? raw.split("").map((ch) => `${ch}${ch}`).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return null;
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}
