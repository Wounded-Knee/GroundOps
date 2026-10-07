import type { Sortie } from "@groundops/contracts";

/** Calendar and countdown use actual departure when sealed, otherwise the estimate. */
export function coalescedStart(sortie: Pick<Sortie, "actualStart" | "scheduledStart">): string {
  return sortie.actualStart ?? sortie.scheduledStart;
}

export function coalescedStartDate(sortie: Pick<Sortie, "actualStart" | "scheduledStart">): Date {
  return new Date(coalescedStart(sortie));
}

/** Calendar uses actual end when sealed, otherwise the estimate. */
export function coalescedEnd(sortie: Pick<Sortie, "actualEnd" | "scheduledEnd">): string {
  return sortie.actualEnd ?? sortie.scheduledEnd;
}

export function coalescedEndDate(sortie: Pick<Sortie, "actualEnd" | "scheduledEnd">): Date {
  return new Date(coalescedEnd(sortie));
}
