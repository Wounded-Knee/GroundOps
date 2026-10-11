import type { GeoCoordinate, SortieStop } from "@groundops/contracts";
import { distanceMeters } from "./guidance";

/** Milliseconds to add for each +1 Minute / auto-extend. */
export const waitExtendMs = 60_000;

/** How long a final-stop fix must stay parked before leaving can complete the sortie. */
export const arrivalDwellMs = 30_000;

export type ArrivalDwellState = {
  anchor: GeoCoordinate | null;
  startedAtMs: number | null;
  satisfied: boolean;
};

export function emptyArrivalDwell(): ArrivalDwellState {
  return { anchor: null, startedAtMs: null, satisfied: false };
}

export function waitEndsAtFromStop(waitMinutes: number, nowMs: number): number {
  return nowMs + Math.max(0, waitMinutes) * waitExtendMs;
}

/** When the countdown has elapsed, bump waitEndsAt by one minute from now (or from the stale end). */
export function extendWaitEndsAt(waitEndsAt: number, nowMs: number): number {
  const base = Math.max(waitEndsAt, nowMs);
  return base + waitExtendMs;
}

export function countdownRemainingSeconds(waitEndsAt: number, nowMs: number): number {
  return Math.max(0, Math.ceil((waitEndsAt - nowMs) / 1000));
}

export function isFinalStop(stops: SortieStop[], stopPosition: number): boolean {
  return stopPosition >= stops.length - 1;
}

export function hasLaterStop(stops: SortieStop[], stopPosition: number): boolean {
  return stopPosition < stops.length - 1;
}

/**
 * Record a GPS sample for the final-stop dwell.
 * A fix outside the destination, or farther than `stationaryMeters` from the anchor, clears an unsatisfied dwell.
 * Once satisfied, later samples keep that result so leaving can complete the sortie.
 */
export function noteArrivalDwell(
  state: ArrivalDwellState,
  input: {
    inside: boolean;
    fix: GeoCoordinate;
    nowMs: number;
    stationaryMeters: number;
  },
): ArrivalDwellState {
  if (state.satisfied) {
    return state;
  }
  if (!input.inside) {
    return emptyArrivalDwell();
  }
  if (
    state.anchor &&
    state.startedAtMs !== null &&
    distanceMeters(input.fix, state.anchor) <= input.stationaryMeters
  ) {
    return settleArrivalDwell(state, input.nowMs);
  }
  return { anchor: input.fix, startedAtMs: input.nowMs, satisfied: false };
}

/** Promote a held anchor once it has lasted `arrivalDwellMs`. Call on a timer while the anchor is unchanged. */
export function settleArrivalDwell(state: ArrivalDwellState, nowMs: number): ArrivalDwellState {
  if (state.satisfied || state.anchor === null || state.startedAtMs === null) {
    return state;
  }
  if (nowMs - state.startedAtMs < arrivalDwellMs) {
    return state;
  }
  return { ...state, satisfied: true };
}

/** Leaving the final stop with no onward destination completes the sortie after a stationary dwell. */
export function shouldCompleteOnLeave(input: {
  isFinal: boolean;
  hasLaterStop: boolean;
  pendingNextLeg: boolean;
  outsideGeofence: boolean;
  stationaryDwellMet: boolean;
}): boolean {
  if (!input.stationaryDwellMet || !input.outsideGeofence || input.hasLaterStop || input.pendingNextLeg) {
    return false;
  }
  return input.isFinal;
}

export function bumpStopWaitMinutes(stops: SortieStop[], stopPosition: number): SortieStop[] {
  return stops.map((stop, index) =>
    index === stopPosition ? { ...stop, waitMinutes: stop.waitMinutes + 1 } : stop,
  );
}
