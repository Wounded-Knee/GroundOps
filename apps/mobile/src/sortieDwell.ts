import type { SortieStop } from "@groundops/contracts";

/** Milliseconds to add for each +1 Minute / auto-extend. */
export const waitExtendMs = 60_000;

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

export function bumpStopWaitMinutes(stops: SortieStop[], stopPosition: number): SortieStop[] {
  return stops.map((stop, index) =>
    index === stopPosition ? { ...stop, waitMinutes: stop.waitMinutes + 1 } : stop,
  );
}
