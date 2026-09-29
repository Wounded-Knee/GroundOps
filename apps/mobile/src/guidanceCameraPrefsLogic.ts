import { guidanceTilt, guidanceZoom } from "./guidance";

export type GuidanceCameraPrefs = {
  zoom: number;
  tilt: number;
};

export const guidanceZoomRange = { min: 10, max: 20 } as const;
export const guidanceTiltRange = { min: 0, max: 67.5 } as const;

export const defaultGuidanceCameraPrefs: GuidanceCameraPrefs = {
  zoom: guidanceZoom,
  tilt: guidanceTilt,
};

export function parseGuidanceCameraPrefs(raw: string | null): GuidanceCameraPrefs | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GuidanceCameraPrefs>;
    if (typeof parsed.zoom !== "number" || typeof parsed.tilt !== "number") {
      return null;
    }
    return normalizeGuidanceCameraPrefs({ zoom: parsed.zoom, tilt: parsed.tilt });
  } catch {
    return null;
  }
}

export function normalizeGuidanceCameraPrefs(input: GuidanceCameraPrefs): GuidanceCameraPrefs {
  return {
    zoom: clamp(input.zoom, guidanceZoomRange.min, guidanceZoomRange.max),
    tilt: clamp(input.tilt, guidanceTiltRange.min, guidanceTiltRange.max),
  };
}

export function parseGuidanceCameraFields(zoomText: string, tiltText: string): GuidanceCameraPrefs | null {
  const zoom = parseDecimal(zoomText);
  const tilt = parseDecimal(tiltText);
  if (zoom === null || tilt === null) {
    return null;
  }
  return normalizeGuidanceCameraPrefs({ zoom, tilt });
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
