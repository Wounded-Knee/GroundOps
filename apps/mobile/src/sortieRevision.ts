import type { SortieStop } from "@groundops/contracts";

/** Same identity `mergeStopActuals` uses when preserving arrival times. */
export function sameStopPlace(left: SortieStop, right: SortieStop): boolean {
  return left.label === right.label && left.latitude === right.latitude && left.longitude === right.longitude;
}

export function samePlaceOrder(previous: SortieStop[], next: SortieStop[]): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  return previous.every((stop, index) => {
    const other = next[index];
    return other !== undefined && sameStopPlace(stop, other);
  });
}

/**
 * Index of the next stop to guide toward after the stop list is revised.
 * Stops before `firstStopPosition` are already passed and stay behind the active
 * leg when they still match. A waypoint inserted before the current destination
 * becomes the active stop.
 */
export function activeStopAfterRevision(
  previous: SortieStop[],
  firstStopPosition: number,
  next: SortieStop[],
): number {
  if (next.length === 0) {
    return 0;
  }
  const passedCount = Math.min(Math.max(0, firstStopPosition), previous.length);
  let index = 0;
  while (index < passedCount && index < next.length && sameStopPlace(previous[index]!, next[index]!)) {
    index += 1;
  }
  if (index < passedCount) {
    const stillPassed = previous.slice(index, passedCount);
    while (index < next.length && stillPassed.some((stop) => sameStopPlace(stop, next[index]!))) {
      index += 1;
    }
  }
  return Math.min(index, next.length - 1);
}

/**
 * Index of the stop the driver is already dwelling at, after a revision.
 * A waypoint inserted ahead of that place does not move the dwell.
 */
export function dwellStopAfterRevision(
  previous: SortieStop[],
  stopPosition: number,
  next: SortieStop[],
): number {
  if (next.length === 0) {
    return 0;
  }
  const current = previous[stopPosition];
  if (!current) {
    return Math.min(Math.max(0, stopPosition), next.length - 1);
  }
  const found = next.findIndex((stop) => sameStopPlace(stop, current));
  if (found >= 0) {
    return found;
  }
  return Math.min(Math.max(0, stopPosition), next.length - 1);
}
