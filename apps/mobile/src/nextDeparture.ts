import type { Sortie } from "@groundops/contracts";
import { coalescedStart } from "./sortieStart";

export type NextDeparture = {
  sortieId: string;
  departAt: Date;
  label: string;
};

export type DepartureAlertMark = {
  minutesBefore: 5 | 1 | 0;
  fireAt: Date;
};

const alertMinutes = [5, 1, 0] as const;

/** Earliest future uncommenced coalesced start among authored sorties. */
export function nextDeparture(sorties: Sortie[], now: Date): NextDeparture | null {
  let best: NextDeparture | null = null;
  for (const sortie of sorties) {
    if (sortie.actualStart !== null) {
      continue;
    }
    const departAt = new Date(coalescedStart(sortie));
    if (Number.isNaN(departAt.getTime()) || departAt.getTime() <= now.getTime()) {
      continue;
    }
    const first =
      sortie.stops.find((stop) => stop.role === "pickup") ??
      sortie.stops.find((stop) => stop.role === "destination");
    const label = first?.label.trim() || sortie.label.trim() || "sortie";
    if (best === null || departAt.getTime() < best.departAt.getTime()) {
      best = { sortieId: sortie.id, departAt, label };
    }
  }
  return best;
}

/** Remaining T−5 / T−1 / T−0 marks still in the future for a departure. */
export function departureAlertMarks(departAt: Date, now: Date): DepartureAlertMark[] {
  const marks: DepartureAlertMark[] = [];
  for (const minutesBefore of alertMinutes) {
    const fireAt = new Date(departAt.getTime() - minutesBefore * 60_000);
    if (fireAt.getTime() > now.getTime()) {
      marks.push({ minutesBefore, fireAt });
    }
  }
  return marks;
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
