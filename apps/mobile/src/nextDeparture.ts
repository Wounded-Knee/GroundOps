import type { Sortie } from "@groundops/contracts";
import { coalescedEndDate, coalescedStartDate } from "./sortieStart";

export type NextDeparture = {
  sortieId: string;
  departAt: Date;
  label: string;
};

/** Which browse-map prompt wins. A due departure replaces the countdown. */
export type DeparturePrompt = "due" | "countdown" | "hidden";

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
    const departAt = coalescedStartDate(sortie);
    if (Number.isNaN(departAt.getTime()) || departAt.getTime() <= now.getTime()) {
      continue;
    }
    if (best === null || departAt.getTime() < best.departAt.getTime()) {
      best = departureOf(sortie, departAt);
    }
  }
  return best;
}

/** Earliest uncommenced sortie whose start has arrived and whose end has not. */
export function dueDeparture(sorties: Sortie[], now: Date): NextDeparture | null {
  let best: NextDeparture | null = null;
  const nowMs = now.getTime();
  for (const sortie of sorties) {
    if (sortie.actualStart !== null) {
      continue;
    }
    const departAt = coalescedStartDate(sortie);
    const endAt = coalescedEndDate(sortie);
    if (Number.isNaN(departAt.getTime()) || Number.isNaN(endAt.getTime())) {
      continue;
    }
    if (departAt.getTime() > nowMs || endAt.getTime() <= nowMs) {
      continue;
    }
    if (best === null || departAt.getTime() < best.departAt.getTime()) {
      best = departureOf(sortie, departAt);
    }
  }
  return best;
}

/** Due departure wins, including when the countdown lead is off. */
export function departurePrompt(
  due: NextDeparture | null,
  upcoming: NextDeparture | null,
  nowMs: number,
  leadMinutes: number | null,
): DeparturePrompt {
  if (due) {
    return "due";
  }
  if (!upcoming) {
    return "hidden";
  }
  const remainingMs = upcoming.departAt.getTime() - nowMs;
  return showDepartureCountdown(remainingMs, leadMinutes) ? "countdown" : "hidden";
}

function departureOf(sortie: Sortie, departAt: Date): NextDeparture {
  const first = sortie.stops[0];
  const label = first?.label.trim() || sortie.label.trim() || "sortie";
  return { sortieId: sortie.id, departAt, label };
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

/** `leadMinutes` of null keeps the countdown hidden. Otherwise it shows at that lead or sooner. */
export function showDepartureCountdown(remainingMs: number, leadMinutes: number | null): boolean {
  if (leadMinutes === null) {
    return false;
  }
  return remainingMs >= 0 && remainingMs <= leadMinutes * 60_000;
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
