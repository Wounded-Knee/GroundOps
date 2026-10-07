import type { SortieStop } from "@groundops/contracts";

/** Whole minutes of inferred dwell when arrive and depart are both sealed; otherwise authored wait. */
export function displayWaitMinutes(stop: SortieStop): number {
  if (stop.actualArrivedAt !== null && stop.actualDepartedAt !== null) {
    const arrived = new Date(stop.actualArrivedAt).getTime();
    const departed = new Date(stop.actualDepartedAt).getTime();
    if (Number.isFinite(arrived) && Number.isFinite(departed) && departed >= arrived) {
      return Math.round((departed - arrived) / 60_000);
    }
  }
  return stop.waitMinutes;
}
