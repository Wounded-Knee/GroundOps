import type { GeoCoordinate, Tariff } from "@groundops/contracts";
import { distanceMeters } from "./guidance";

/** Below this GPS-derived speed, the segment is wait. */
export const stationarySpeedMps = 2;
/** Displacement at or below this is treated as stationary GPS noise, not miles. */
export const stationaryDisplacementMeters = 5;
export const meterAccuracyMeters = 50;
const metersPerMile = 1609.344;

export type MeterSample = {
  fix: GeoCoordinate;
  observedAtMs: number;
  accuracyMeters: number | null;
};

export type MeterState = {
  milesTraveled: number;
  waitSeconds: number;
  last: MeterSample | null;
};

export type MeterCharges = {
  flagCents: number;
  distanceCents: number;
  waitCents: number;
  totalCents: number;
  estimateCents: number;
};

export function emptyMeter(): MeterState {
  return { milesTraveled: 0, waitSeconds: 0, last: null };
}

/**
 * Stationary vs moving is decided only from GPS positions: displacement over elapsed time.
 * Device-reported speed is not used.
 */
export function advanceMeter(state: MeterState, sample: MeterSample): MeterState {
  if (sample.accuracyMeters !== null && sample.accuracyMeters > meterAccuracyMeters) {
    return state;
  }
  const previous = state.last;
  if (!previous) {
    return { ...state, last: sample };
  }
  const elapsedSeconds = Math.max(0, (sample.observedAtMs - previous.observedAtMs) / 1000);
  if (elapsedSeconds <= 0) {
    return { ...state, last: sample };
  }
  const movedMeters = distanceMeters(previous.fix, sample.fix);
  if (isStationary(movedMeters, elapsedSeconds)) {
    return {
      milesTraveled: state.milesTraveled,
      waitSeconds: state.waitSeconds + elapsedSeconds,
      last: sample,
    };
  }
  return {
    milesTraveled: state.milesTraveled + movedMeters / metersPerMile,
    waitSeconds: state.waitSeconds,
    last: sample,
  };
}

/** Continues wait while location updates are sparse and the last fix is still current. */
export function tickMeterWait(state: MeterState, nowMs: number): MeterState {
  const previous = state.last;
  if (!previous) {
    return state;
  }
  const elapsedSeconds = (nowMs - previous.observedAtMs) / 1000;
  if (elapsedSeconds < 1) {
    return state;
  }
  return {
    milesTraveled: state.milesTraveled,
    waitSeconds: state.waitSeconds + elapsedSeconds,
    last: { ...previous, observedAtMs: nowMs },
  };
}

export function isStationary(movedMeters: number, elapsedSeconds: number): boolean {
  if (movedMeters <= stationaryDisplacementMeters) {
    return true;
  }
  if (elapsedSeconds <= 0) {
    return true;
  }
  return movedMeters / elapsedSeconds < stationarySpeedMps;
}

export function meterCharges(
  tariff: Tariff | null,
  milesTraveled: number,
  waitSeconds: number,
  remainingMeters: number,
): MeterCharges | null {
  if (!tariff) {
    return null;
  }
  const waitMinutes = waitSeconds / 60;
  const remainingMiles = Math.max(0, remainingMeters) / metersPerMile;
  const distanceCents = Math.round(milesTraveled * tariff.perMileCents);
  const waitCents = Math.round(waitMinutes * tariff.perWaitMinuteCents);
  const totalCents = tariff.flagCents + distanceCents + waitCents;
  const estimateCents = totalCents + Math.round(remainingMiles * tariff.perMileCents);
  return {
    flagCents: tariff.flagCents,
    distanceCents,
    waitCents,
    totalCents,
    estimateCents,
  };
}

/** Progress is traveled / (traveled + remaining). Remaining comes from the live route, so a wrong-way detour that triggers a longer reroute shrinks the fill. */
export function progressFraction(milesTraveled: number, remainingMeters: number): number {
  const remainingMiles = Math.max(0, remainingMeters) / metersPerMile;
  const total = milesTraveled + remainingMiles;
  if (total <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, milesTraveled / total));
}

export function formatMiles(miles: number): string {
  return miles.toFixed(1);
}

export function formatWaitMinutes(waitSeconds: number): string {
  return String(Math.floor(waitSeconds / 60));
}

export function formatWaitClock(waitSeconds: number): string {
  const total = Math.max(0, Math.floor(waitSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
