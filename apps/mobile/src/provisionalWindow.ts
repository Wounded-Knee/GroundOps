import type { GeoCoordinate, Sortie, SortieStop, SortieWriteRequest } from "@groundops/contracts";
import { taskSortieType } from "@groundops/contracts";
import { distanceMeters } from "./guidance";

/** Straight-line estimate. Thirty miles an hour. The server replaces this with a traffic-aware window. */
export const provisionalMetersPerSecond = 13.4112;

export type ProvisionalWindow = {
  arrivalAt: string;
  scheduledStart: string;
  scheduledEnd: string;
  origin: "shifted" | "previous" | "gps";
};

export function provisionalSortie(input: {
  id: string;
  previous: Sortie | null;
  body: SortieWriteRequest;
  sorties: readonly Sortie[];
  gps: GeoCoordinate | null;
  now: Date;
}): { sortie: Sortie; origin: ProvisionalWindow["origin"] } | "no-origin" {
  const window = provisionalWindow(input);
  if (window === "no-origin") {
    return "no-origin";
  }
  const previousStops = input.previous?.stops ?? [];
  return {
    origin: window.origin,
    sortie: {
      id: input.id,
      type: taskSortieType,
      label: input.body.label.trim(),
      arrivalAt: window.arrivalAt,
      arrivalAuthored: input.body.arrivalAt !== null,
      scheduledStart: window.scheduledStart,
      scheduledEnd: window.scheduledEnd,
      actualStart: input.previous?.actualStart ?? null,
      actualEnd: input.previous?.actualEnd ?? null,
      departureAddress: input.previous?.departureAddress ?? "",
      passengerName: blank(input.body.passengerName),
      passengerPhone: blank(input.body.passengerPhone),
      stops: input.body.stops.map((stop, index) => ({
        label: stop.label.trim(),
        latitude: stop.latitude,
        longitude: stop.longitude,
        waitMinutes: stop.waitMinutes,
        passenger: stop.passenger,
        actualArrivedAt: previousStops[index]?.actualArrivedAt ?? null,
        actualDepartedAt: previousStops[index]?.actualDepartedAt ?? null,
      })),
    },
  };
}

export function provisionalWindow(input: {
  previous: Sortie | null;
  body: SortieWriteRequest;
  sorties: readonly Sortie[];
  gps: GeoCoordinate | null;
  now: Date;
}): ProvisionalWindow | "no-origin" {
  if (input.previous && input.body.arrivalAt && sameStops(input.body.stops, input.previous.stops)) {
    const delta = new Date(input.body.arrivalAt).getTime() - new Date(input.previous.arrivalAt).getTime();
    return {
      arrivalAt: input.body.arrivalAt,
      scheduledStart: new Date(new Date(input.previous.scheduledStart).getTime() + delta).toISOString(),
      scheduledEnd: new Date(new Date(input.previous.scheduledEnd).getTime() + delta).toISOString(),
      origin: "shifted",
    };
  }

  const origin = draftOrigin(input.sorties, input.body.arrivalAt, input.previous?.id ?? null, input.gps, input.now);
  if (!origin) {
    return "no-origin";
  }
  const first = input.body.stops[0];
  if (!first) {
    return "no-origin";
  }
  const approach = legSeconds(origin.position, first);
  const onward = onwardSeconds(input.body.stops);
  const dwell = input.body.stops.reduce((total, stop) => total + stop.waitMinutes * 60, 0);
  if (input.body.arrivalAt) {
    const arrival = new Date(input.body.arrivalAt).getTime();
    return {
      arrivalAt: input.body.arrivalAt,
      scheduledStart: new Date(arrival - approach * 1000).toISOString(),
      scheduledEnd: new Date(arrival + (dwell + onward) * 1000).toISOString(),
      origin: origin.kind,
    };
  }
  const start = input.now.getTime();
  const arrival = start + approach * 1000;
  return {
    arrivalAt: new Date(arrival).toISOString(),
    scheduledStart: input.now.toISOString(),
    scheduledEnd: new Date(arrival + (dwell + onward) * 1000).toISOString(),
    origin: origin.kind,
  };
}

export function rangeCovers(cached: { from: string; to: string }, range: { from: Date; to: Date }): boolean {
  const from = new Date(cached.from).getTime();
  const to = new Date(cached.to).getTime();
  return from <= range.from.getTime() && to >= range.to.getTime();
}

export function overlaySorties(server: readonly Sortie[], pending: readonly Sortie[]): Sortie[] {
  const byId = new Map(server.map((sortie) => [sortie.id, sortie]));
  for (const sortie of pending) {
    byId.set(sortie.id, sortie);
  }
  return [...byId.values()].sort((left, right) => {
    const start = new Date(left.scheduledStart).getTime() - new Date(right.scheduledStart).getTime();
    if (start !== 0) {
      return start;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function draftOrigin(
  sorties: readonly Sortie[],
  arrivalAt: string | null,
  excludeId: string | null,
  gps: GeoCoordinate | null,
  now: Date,
): { position: GeoCoordinate; kind: "previous" | "gps" } | null {
  if (arrivalAt) {
    const previous = previousPlace(sorties, new Date(arrivalAt), excludeId, now);
    const last = previous?.stops[previous.stops.length - 1];
    if (last) {
      return { position: { latitude: last.latitude, longitude: last.longitude }, kind: "previous" };
    }
  }
  if (!gps) {
    return null;
  }
  return { position: gps, kind: "gps" };
}

function previousPlace(sorties: readonly Sortie[], arrivalAt: Date, excludeId: string | null, now: Date): Sortie | null {
  let previous: Sortie | null = null;
  for (const sortie of sorties) {
    if (excludeId !== null && sortie.id === excludeId) {
      continue;
    }
    if (!stillOpen(sortie, now, sorties)) {
      continue;
    }
    if (new Date(sortie.arrivalAt).getTime() >= arrivalAt.getTime()) {
      continue;
    }
    if (previous === null || new Date(previous.arrivalAt).getTime() < new Date(sortie.arrivalAt).getTime()) {
      previous = sortie;
    }
  }
  return previous;
}

function stillOpen(sortie: Sortie, now: Date, sorties: readonly Sortie[]): boolean {
  if (sortie.actualEnd !== null) {
    return false;
  }
  if (new Date(sortie.scheduledEnd).getTime() > now.getTime()) {
    return true;
  }
  if (sortie.actualStart === null) {
    return false;
  }
  const started = new Date(sortie.actualStart).getTime();
  return !sorties.some(
    (other) => other.id !== sortie.id && other.actualStart !== null && new Date(other.actualStart).getTime() > started,
  );
}

function sameStops(body: SortieWriteRequest["stops"], stops: readonly SortieStop[]): boolean {
  if (body.length !== stops.length) {
    return false;
  }
  return body.every((stop, index) => {
    const previous = stops[index];
    return (
      previous !== undefined &&
      stop.label.trim() === previous.label &&
      stop.latitude === previous.latitude &&
      stop.longitude === previous.longitude &&
      stop.waitMinutes === previous.waitMinutes &&
      stop.passenger === previous.passenger
    );
  });
}

function legSeconds(from: GeoCoordinate, to: GeoCoordinate): number {
  return distanceMeters(from, to) / provisionalMetersPerSecond;
}

function onwardSeconds(stops: SortieWriteRequest["stops"]): number {
  let seconds = 0;
  for (let index = 1; index < stops.length; index += 1) {
    const from = stops[index - 1];
    const to = stops[index];
    if (!from || !to) {
      continue;
    }
    seconds += legSeconds(from, to);
  }
  return seconds;
}

function blank(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
