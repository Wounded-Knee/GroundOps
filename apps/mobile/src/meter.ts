import type { GeoCoordinate, Tariff } from "@groundops/contracts";
import { distanceMeters, offRouteMeters, projectOntoPath } from "./guidance";

/** Below this GPS-derived speed, the segment is wait. */
export const stationarySpeedMps = 2;
/** Displacement at or below this is treated as stationary GPS noise, not miles. */
export const stationaryDisplacementMeters = 5;
export const meterAccuracyMeters = 50;
/**
 * GPS silence after a moving sample that implies the vehicle stopped.
 * Matches the navigation watch distance interval: no 5 m update in this window means < 1 m/s.
 */
export const gpsSilenceStationarySeconds = 5;
const metersPerMile = 1609.344;

export type MeterSample = {
  fix: GeoCoordinate;
  observedAtMs: number;
  accuracyMeters: number | null;
};

/** Motion relative to successive GPS samples; unknown until the second sample. */
export type MeterMotion = "unknown" | "stationary" | "moving";

export type MeterState = {
  milesTraveled: number;
  waitSeconds: number;
  last: MeterSample | null;
  /** Last projected distance along the current route path. */
  alongMeters: number | null;
  motion: MeterMotion;
};

export type MeterCharges = {
  flagCents: number;
  distanceCents: number;
  waitCents: number;
  totalCents: number;
  estimateCents: number;
};

export type RouteMeterSample = MeterSample & {
  routePath: GeoCoordinate[];
};

export function emptyMeter(): MeterState {
  return { milesTraveled: 0, waitSeconds: 0, last: null, alongMeters: null, motion: "unknown" };
}

/** Reset path tracking after a reroute without clearing cumulative miles or wait. */
export function resetMeterRouteProgress(state: MeterState, alongMeters: number | null): MeterState {
  return { ...state, alongMeters };
}

/**
 * Advance the meter from a GPS sample against the active route path.
 * Miles traveled increase only with forward progress along the polyline.
 * Off-route samples update wait/motion only.
 */
export function advanceMeterAlongRoute(state: MeterState, sample: RouteMeterSample): MeterState {
  if (sample.accuracyMeters !== null && sample.accuracyMeters > meterAccuracyMeters) {
    return state;
  }

  const previous = state.last;
  const projection =
    sample.routePath.length >= 2 ? projectOntoPath(sample.fix, sample.routePath) : null;
  const onRoute = projection !== null && projection.distanceToPathMeters <= offRouteMeters;

  if (!previous) {
    return {
      ...state,
      last: sample,
      alongMeters: onRoute ? projection.alongMeters : state.alongMeters,
      motion: "unknown",
    };
  }

  const elapsedSeconds = Math.max(0, (sample.observedAtMs - previous.observedAtMs) / 1000);
  if (elapsedSeconds <= 0) {
    return {
      ...state,
      last: sample,
      alongMeters: onRoute ? projection.alongMeters : state.alongMeters,
    };
  }

  const movedMeters = distanceMeters(previous.fix, sample.fix);
  const stationary = isStationary(movedMeters, elapsedSeconds);

  if (stationary) {
    return {
      milesTraveled: state.milesTraveled,
      waitSeconds: state.waitSeconds + elapsedSeconds,
      last: sample,
      alongMeters: onRoute ? projection.alongMeters : state.alongMeters,
      motion: "stationary",
    };
  }

  let milesTraveled = state.milesTraveled;
  let alongMeters = state.alongMeters;
  if (onRoute && projection) {
    if (alongMeters !== null && projection.alongMeters > alongMeters) {
      milesTraveled += (projection.alongMeters - alongMeters) / metersPerMile;
    }
    alongMeters = projection.alongMeters;
  }

  return {
    milesTraveled,
    waitSeconds: state.waitSeconds,
    last: sample,
    alongMeters,
    motion: "moving",
  };
}

/**
 * Continues wait at least once per second while stopped.
 * Accrues when the last GPS segment was stationary, when motion is still unknown
 * (parked before a second fix — common with distance-interval watches), or after
 * enough GPS silence following movement that the vehicle must have stopped.
 */
export function tickMeterWait(state: MeterState, nowMs: number): MeterState {
  const previous = state.last;
  if (!previous) {
    return state;
  }
  const elapsedSeconds = (nowMs - previous.observedAtMs) / 1000;
  if (elapsedSeconds < 1) {
    return state;
  }
  if (state.motion === "moving" && elapsedSeconds < gpsSilenceStationarySeconds) {
    return state;
  }
  return {
    ...state,
    waitSeconds: state.waitSeconds + elapsedSeconds,
    last: { ...previous, observedAtMs: nowMs },
    motion: "stationary",
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

/** Proximity to destination along the active route: 1 - remaining/baseline. */
export function progressFraction(remainingMeters: number, baselineRemainingMeters: number): number {
  if (baselineRemainingMeters <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, 1 - Math.max(0, remainingMeters) / baselineRemainingMeters));
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

/** Pre-trip fare from tariff and full route distance; "—" when tariff is missing. */
export function formatTripEstimate(tariff: Tariff | null, distanceMeters: number): string {
  const charges = meterCharges(tariff, 0, 0, distanceMeters);
  return charges ? formatMoney(charges.estimateCents) : "—";
}
