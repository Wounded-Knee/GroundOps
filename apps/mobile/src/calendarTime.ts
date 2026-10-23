import type { AvailabilityInterval, Sortie } from "@groundops/contracts";
import { distanceMeters } from "./guidance";
import { coalescedEndDate, coalescedStartDate } from "./sortieStart";

export type CalendarScope = "month" | "week" | "day" | "agenda";

const agendaFrom = new Date(Date.UTC(1970, 0, 1));
const agendaTo = new Date(Date.UTC(2100, 0, 1));

export const hourHeight = 64;
export const hourHeightMin = 32;
export const hourHeightMax = 160;
export const snapMinutes = 15;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

/** Test-only override. `null` means use the normal web/host detection. */
let calendarTimeZoneOverride: string | undefined | null = null;

/** Lets tests exercise the explicit IANA zone path without a DOM. */
export function setCalendarTimeZoneOverride(zone: string | undefined | null): void {
  calendarTimeZoneOverride = zone;
}

/**
 * Explicit calendar zone for web when the host injects EXPO_PUBLIC_CALENDAR_TIMEZONE.
 * Native and Node keep the runtime's local Date methods.
 */
export function calendarTimeZone(): string | undefined {
  if (calendarTimeZoneOverride !== null) {
    return calendarTimeZoneOverride;
  }
  if (typeof document === "undefined") {
    return undefined;
  }
  const configured = process.env.EXPO_PUBLIC_CALENDAR_TIMEZONE;
  return configured && configured.length > 0 ? configured : undefined;
}

export function clampHourHeight(value: number, pixelRatio = 1): number {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  const snapped = Math.round(value * ratio) / ratio;
  return Math.min(hourHeightMax, Math.max(hourHeightMin, snapped));
}

/**
 * Scroll offset that keeps `anchorContentY` (a content Y at `startHourPx`) under `focalInScroll`
 * after the hour scale becomes `nextHourPx`.
 */
export function zoomedScrollY(
  anchorContentY: number,
  startHourPx: number,
  nextHourPx: number,
  focalInScroll: number,
  viewportHeight: number,
): number {
  if (startHourPx <= 0) {
    return 0;
  }
  const maxScroll = Math.max(0, 24 * nextHourPx - Math.max(0, viewportHeight));
  const y = anchorContentY * (nextHourPx / startHourPx) - focalInScroll;
  return Math.min(maxScroll, Math.max(0, y));
}

export function startOfDay(date: Date): Date {
  const parts = zonedTime(date);
  return instantFromZoned(parts.year, parts.month, parts.day, 0, 0, 0);
}

export function addDays(date: Date, days: number): Date {
  const parts = zonedTime(date);
  const noonUtc = Date.UTC(parts.year, parts.month, parts.day + days, 12, 0, 0);
  const shifted = new Date(noonUtc);
  return instantFromZoned(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    parts.hour,
    parts.minute,
    parts.second,
  );
}

export function addMinutes(date: Date, minutes: number): Date {
  if (!calendarTimeZone()) {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes() + minutes,
      date.getSeconds(),
      date.getMilliseconds(),
    );
  }
  return new Date(date.getTime() + minutes * 60_000);
}

export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -zonedTime(day).weekday);
}

export function sameLocalDay(left: Date, right: Date): boolean {
  const a = zonedTime(left);
  const b = zonedTime(right);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function visibleRange(scope: CalendarScope, anchor: Date): { from: Date; to: Date } {
  if (scope === "agenda") {
    return { from: new Date(agendaFrom), to: new Date(agendaTo) };
  }
  if (scope === "day") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  if (scope === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  const parts = zonedTime(anchor);
  const first = instantFromZoned(parts.year, parts.month, 1);
  const gridStart = startOfWeek(first);
  const last = instantFromZoned(parts.year, parts.month + 1, 0);
  return { from: gridStart, to: addDays(startOfWeek(last), 7) };
}

export function shiftAnchor(scope: CalendarScope, anchor: Date, direction: -1 | 1): Date {
  if (scope === "agenda") {
    return anchor;
  }
  if (scope === "day") {
    return addDays(startOfDay(anchor), direction);
  }
  if (scope === "week") {
    return addDays(startOfWeek(anchor), direction * 7);
  }
  const parts = zonedTime(anchor);
  return instantFromZoned(parts.year, parts.month + direction, 1);
}

export function periodLabel(scope: CalendarScope, anchor: Date): string {
  const zone = calendarTimeZone();
  const opts = zone ? { timeZone: zone } : {};
  if (scope === "agenda") {
    return "Agenda";
  }
  if (scope === "day") {
    return anchor.toLocaleDateString([], { ...opts, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  if (scope === "week") {
    const from = startOfWeek(anchor);
    const until = addDays(from, 6);
    const fromParts = zonedTime(from);
    const untilParts = zonedTime(until);
    const sameYear = fromParts.year === untilParts.year;
    const start = from.toLocaleDateString([], { ...opts, month: "short", day: "numeric" });
    const end = until.toLocaleDateString([], {
      ...opts,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return sameYear
      ? `${start} – ${end}`
      : `${from.toLocaleDateString([], { ...opts, month: "short", day: "numeric", year: "numeric" })} – ${end}`;
  }
  return anchor.toLocaleDateString([], { ...opts, month: "long", year: "numeric" });
}

type AgendaSortie = Pick<Sortie, "id" | "actualStart" | "actualEnd" | "scheduledStart" | "scheduledEnd">;

/** A sortie is past once its coalesced end is at or before now. */
export function sortieIsPast(sortie: Pick<Sortie, "actualEnd" | "scheduledEnd">, now: Date): boolean {
  return coalescedEndDate(sortie).getTime() <= now.getTime();
}

/** Present and future sorties, soonest coalesced start first. */
export function upcomingSorties<T extends AgendaSortie>(sorties: readonly T[], now: Date): T[] {
  return sorties.filter((sortie) => !sortieIsPast(sortie, now)).sort(byStart);
}

/** Past sorties, most recently ended first. */
export function historySorties<T extends AgendaSortie>(sorties: readonly T[], now: Date): T[] {
  return sorties.filter((sortie) => sortieIsPast(sortie, now)).sort(byEndDescending);
}

function byStart(left: AgendaSortie, right: AgendaSortie): number {
  const delta = coalescedStartDate(left).getTime() - coalescedStartDate(right).getTime();
  return delta !== 0 ? delta : compareId(left.id, right.id);
}

function byEndDescending(left: AgendaSortie, right: AgendaSortie): number {
  const delta = coalescedEndDate(right).getTime() - coalescedEndDate(left).getTime();
  return delta !== 0 ? delta : compareId(left.id, right.id);
}

function compareId(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function monthGridDays(anchor: Date): Date[] {
  const range = visibleRange("month", anchor);
  const days: Date[] = [];
  for (let cursor = range.from; cursor < range.to; cursor = addDays(cursor, 1)) {
    days.push(new Date(cursor));
  }
  return days;
}

export function weekDays(anchor: Date): Date[] {
  const from = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(from, index));
}

export function calendarDayDelta(from: Date, to: Date): number {
  const startParts = zonedTime(from);
  const endParts = zonedTime(to);
  const start = Date.UTC(startParts.year, startParts.month, startParts.day);
  const end = Date.UTC(endParts.year, endParts.month, endParts.day);
  return Math.round((end - start) / 86_400_000);
}

export function minuteDeltaFromPixels(dy: number, pixelsPerHour = hourHeight): number {
  return Math.round(((dy / pixelsPerHour) * 60) / snapMinutes) * snapMinutes;
}

export function dayDeltaFromPixels(dx: number, columnWidth: number): number {
  if (columnWidth <= 0) {
    return 0;
  }
  return Math.round(dx / columnWidth);
}

export type Interval = { start: Date; end: Date };

export function moveInterval(start: Date, end: Date, dayDelta: number, minuteDelta: number): Interval | null {
  if (dayDelta === 0 && minuteDelta === 0) {
    return null;
  }
  const nextStart = addMinutes(addDays(start, dayDelta), minuteDelta);
  const nextEnd = addMinutes(addDays(end, dayDelta), minuteDelta);
  if (nextStart.getTime() >= nextEnd.getTime()) {
    return null;
  }
  return { start: nextStart, end: nextEnd };
}

export function resizeStart(start: Date, end: Date, minuteDelta: number): Interval | null {
  if (minuteDelta === 0) {
    return null;
  }
  const next = addMinutes(start, minuteDelta);
  if (next.getTime() >= end.getTime()) {
    return null;
  }
  return { start: next, end };
}

export function resizeEnd(start: Date, end: Date, minuteDelta: number): Interval | null {
  if (minuteDelta === 0) {
    return null;
  }
  const next = addMinutes(end, minuteDelta);
  if (start.getTime() >= next.getTime()) {
    return null;
  }
  return { start, end: next };
}

export function shiftArrival(arrival: Date, dayDelta: number, minuteDelta: number): Date | null {
  if (dayDelta === 0 && minuteDelta === 0) {
    return null;
  }
  return addMinutes(addDays(arrival, dayDelta), minuteDelta);
}

export function shiftIntervalDays(start: Date, end: Date, dayDelta: number): Interval | null {
  if (dayDelta === 0) {
    return null;
  }
  const nextStart = addDays(start, dayDelta);
  const nextEnd = addDays(end, dayDelta);
  if (nextStart.getTime() >= nextEnd.getTime()) {
    return null;
  }
  return { start: nextStart, end: nextEnd };
}

export function withPickedDate(base: Date, picked: Date): Date {
  const baseParts = zonedTime(base);
  const pickedParts = zonedTime(picked);
  return instantFromZoned(
    pickedParts.year,
    pickedParts.month,
    pickedParts.day,
    baseParts.hour,
    baseParts.minute,
    0,
  );
}

export function withPickedTime(base: Date, picked: Date): Date {
  const baseParts = zonedTime(base);
  const pickedParts = zonedTime(picked);
  return instantFromZoned(baseParts.year, baseParts.month, baseParts.day, pickedParts.hour, pickedParts.minute, 0);
}

export function hourSlot(day: Date, hour: number): Interval {
  const parts = zonedTime(day);
  const start = instantFromZoned(parts.year, parts.month, parts.day, hour, 0, 0);
  return { start, end: new Date(start.getTime() + 60 * 60 * 1000) };
}

export function minutesFromMidnight(date: Date): number {
  const parts = zonedTime(date);
  return parts.hour * 60 + parts.minute;
}

export function nowLineTop(now: Date, pixelsPerHour: number): number {
  return (minutesFromMidnight(now) / 60) * pixelsPerHour;
}

export function parseAvailabilityIntervals(value: unknown): AvailabilityInterval[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const intervals: AvailabilityInterval[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.start !== "string" || (record.end !== null && typeof record.end !== "string")) {
      return null;
    }
    intervals.push({ start: record.start, end: record.end });
  }
  return intervals;
}

/** Hour-grid stripes for intervals the server treated as available. An open interval ends at `now`. */
export function availabilityBlocksOnDay(
  intervals: AvailabilityInterval[],
  day: Date,
  now: Date,
  pixelsPerHour = hourHeight,
): { top: number; height: number }[] {
  const blocks: { top: number; height: number }[] = [];
  for (const interval of intervals) {
    const start = new Date(interval.start);
    const end = interval.end === null ? now : new Date(interval.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      continue;
    }
    const block = blockOnDay(start, end, day, pixelsPerHour);
    if (block && block.height > 0) {
      blocks.push(block);
    }
  }
  return blocks;
}

export function blockOnDay(
  start: Date,
  end: Date,
  day: Date,
  pixelsPerHour = hourHeight,
): { top: number; height: number } | null {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  if (end.getTime() <= dayStart.getTime() || start.getTime() >= dayEnd.getTime()) {
    return null;
  }
  const visibleStart = start.getTime() < dayStart.getTime() ? dayStart : start;
  const visibleEnd = end.getTime() > dayEnd.getTime() ? dayEnd : end;
  const startMinutes = visibleStart.getTime() === dayStart.getTime() ? 0 : minutesFromMidnight(visibleStart);
  const endMinutes = visibleEnd.getTime() === dayEnd.getTime() ? 24 * 60 : minutesFromMidnight(visibleEnd);
  const top = (startMinutes / 60) * pixelsPerHour;
  const height = ((endMinutes - startMinutes) / 60) * pixelsPerHour;
  return { top, height };
}

export type ActivityKind = "deadhead" | "passenger" | "wait";

export type ActivitySegment = {
  kind: ActivityKind;
  start: Date;
  end: Date;
};

export type StopArrivalMark = {
  at: Date;
  label: string;
};

export type SortieActivities = {
  segments: ActivitySegment[];
  arrivals: StopArrivalMark[];
};

export type ClippedActivityBand = {
  kind: ActivityKind;
  fraction: number;
};

export type ClippedStopArrival = {
  label: string;
  fraction: number;
};

const minuteMs = 60_000;

/**
 * Drive and wait bands for one sortie, plus a mark at each stop arrival.
 * The approach is the gap from the coalesced start to arrival. Onward driving
 * is whatever remains after authored waits, split by straight-line distance.
 */
export function sortieActivitySegments(
  sortie: Pick<Sortie, "actualStart" | "scheduledStart" | "actualEnd" | "scheduledEnd" | "arrivalAt" | "stops">,
): SortieActivities {
  const start = coalescedStartDate(sortie);
  const end = coalescedEndDate(sortie);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const windowMs = endMs - startMs;
  const first = sortie.stops[0];
  if (!(windowMs > 0) || !first) {
    return { segments: [], arrivals: [] };
  }

  const parsedArrival = new Date(sortie.arrivalAt);
  const arrivalMs = Number.isNaN(parsedArrival.getTime()) ? startMs : parsedArrival.getTime();
  const approachMs = Math.min(endMs, Math.max(startMs, arrivalMs)) - startMs;
  const remainingMs = windowMs - approachMs;
  const authoredWaits = sortie.stops.map((stop) => Math.max(0, stop.waitMinutes) * minuteMs);
  const totalWait = authoredWaits.reduce((sum, wait) => sum + wait, 0);
  const laterCount = sortie.stops.length - 1;

  let waits = authoredWaits;
  let drives: number[] = [];
  if (totalWait > remainingMs && totalWait > 0) {
    const scale = remainingMs / totalWait;
    waits = authoredWaits.map((wait) => wait * scale);
    drives = Array.from({ length: laterCount }, () => 0);
  } else if (laterCount === 0) {
    drives = [];
  } else {
    const distances: number[] = [];
    for (let index = 1; index < sortie.stops.length; index += 1) {
      const previous = sortie.stops[index - 1];
      const next = sortie.stops[index];
      if (!previous || !next) {
        distances.push(0);
        continue;
      }
      distances.push(
        distanceMeters(
          { latitude: previous.latitude, longitude: previous.longitude },
          { latitude: next.latitude, longitude: next.longitude },
        ),
      );
    }
    drives = splitDrive(remainingMs - totalWait, distances);
  }

  const segments: ActivitySegment[] = [];
  const arrivals: StopArrivalMark[] = [];
  let cursor = startMs;
  if (approachMs > 0) {
    segments.push({
      kind: driveKind(first),
      start: new Date(cursor),
      end: new Date(cursor + approachMs),
    });
    cursor += approachMs;
  }

  for (let index = 0; index < sortie.stops.length; index += 1) {
    const stop = sortie.stops[index];
    if (!stop) {
      continue;
    }
    if (index > 0) {
      const drive = drives[index - 1] ?? 0;
      if (drive > 0) {
        segments.push({
          kind: driveKind(stop),
          start: new Date(cursor),
          end: new Date(cursor + drive),
        });
        cursor += drive;
      }
    }
    arrivals.push({
      at: index === 0 ? new Date(arrivalMs) : new Date(cursor),
      label: stop.label,
    });
    const wait = waits[index] ?? 0;
    if (wait > 0) {
      segments.push({
        kind: "wait",
        start: new Date(cursor),
        end: new Date(cursor + wait),
      });
      cursor += wait;
    }
  }

  if (segments.length === 0) {
    segments.push({ kind: driveKind(first), start, end });
  } else {
    const last = segments[segments.length - 1];
    if (last && last.start.getTime() < endMs) {
      last.end = end;
    }
  }

  return { segments, arrivals: mergeArrivals(arrivals) };
}

/** Band fractions and arrival offsets for the part of a sortie visible on one day. */
export function clipActivitiesToDay(
  activities: SortieActivities,
  windowStart: Date,
  windowEnd: Date,
  day: Date,
): { bands: ClippedActivityBand[]; arrivals: ClippedStopArrival[] } {
  const visible = visibleWindowOnDay(windowStart, windowEnd, day);
  if (!visible) {
    return { bands: [], arrivals: [] };
  }
  const visibleStart = visible.start.getTime();
  const visibleEnd = visible.end.getTime();
  const visibleMs = visibleEnd - visibleStart;
  if (!(visibleMs > 0)) {
    return { bands: [], arrivals: [] };
  }

  const bands: ClippedActivityBand[] = [];
  for (const segment of activities.segments) {
    const overlapStart = Math.max(segment.start.getTime(), visibleStart);
    const overlapEnd = Math.min(segment.end.getTime(), visibleEnd);
    if (overlapEnd <= overlapStart) {
      continue;
    }
    bands.push({ kind: segment.kind, fraction: (overlapEnd - overlapStart) / visibleMs });
  }

  const windowEndMs = windowEnd.getTime();
  const arrivals: ClippedStopArrival[] = [];
  for (const arrival of activities.arrivals) {
    const at = arrival.at.getTime();
    if (!arrivalInSlice(at, visibleStart, visibleEnd, windowEndMs)) {
      continue;
    }
    const fraction = (at - visibleStart) / visibleMs;
    const previous = arrivals[arrivals.length - 1];
    if (previous && Math.abs(previous.fraction - fraction) < 1e-9) {
      previous.label = joinLabels(previous.label, arrival.label);
      continue;
    }
    arrivals.push({ label: arrival.label, fraction });
  }
  return { bands, arrivals };
}

function driveKind(stop: { passenger: boolean }): ActivityKind {
  return stop.passenger ? "passenger" : "deadhead";
}

function splitDrive(residualMs: number, distances: number[]): number[] {
  if (distances.length === 0) {
    return [];
  }
  if (!(residualMs > 0)) {
    return distances.map(() => 0);
  }
  const total = distances.reduce((sum, distance) => sum + Math.max(0, distance), 0);
  if (!(total > 0)) {
    const each = residualMs / distances.length;
    return distances.map((_, index) =>
      index === distances.length - 1 ? residualMs - each * (distances.length - 1) : each,
    );
  }
  const drives: number[] = [];
  let used = 0;
  for (let index = 0; index < distances.length; index += 1) {
    if (index === distances.length - 1) {
      drives.push(residualMs - used);
      break;
    }
    const share = (residualMs * Math.max(0, distances[index] ?? 0)) / total;
    drives.push(share);
    used += share;
  }
  return drives;
}

function mergeArrivals(arrivals: StopArrivalMark[]): StopArrivalMark[] {
  const merged: StopArrivalMark[] = [];
  for (const arrival of arrivals) {
    const previous = merged[merged.length - 1];
    if (previous && previous.at.getTime() === arrival.at.getTime()) {
      previous.label = joinLabels(previous.label, arrival.label);
      continue;
    }
    merged.push({ at: arrival.at, label: arrival.label });
  }
  return merged;
}

function joinLabels(left: string, right: string): string {
  if (left.length === 0) {
    return right;
  }
  if (right.length === 0 || right === left) {
    return left;
  }
  return `${left} · ${right}`;
}

function visibleWindowOnDay(start: Date, end: Date, day: Date): { start: Date; end: Date } | null {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  if (end.getTime() <= dayStart.getTime() || start.getTime() >= dayEnd.getTime()) {
    return null;
  }
  return {
    start: start.getTime() < dayStart.getTime() ? dayStart : start,
    end: end.getTime() > dayEnd.getTime() ? dayEnd : end,
  };
}

/** An arrival on the midnight boundary stays with the day the sortie ends, otherwise the day it falls in. */
function arrivalInSlice(at: number, visibleStart: number, visibleEnd: number, windowEnd: number): boolean {
  if (at < visibleStart || at > visibleEnd) {
    return false;
  }
  if (at < visibleEnd) {
    return true;
  }
  return at === windowEnd;
}

export type LanePlacement = { column: number; span: number; columns: number };

type LaneInterval = { id: string; start: number; end: number };

function clipToDay(start: Date, end: Date, day: Date): { start: number; end: number } | null {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const visibleStart = Math.max(start.getTime(), dayStart);
  const visibleEnd = Math.min(end.getTime(), dayEnd);
  if (visibleEnd <= visibleStart) {
    return null;
  }
  return { start: visibleStart, end: visibleEnd };
}

function overlaps(left: LaneInterval, right: LaneInterval): boolean {
  return left.start < right.end && right.start < left.end;
}

/** Side-by-side lanes for sorties visible on one day. Ranges are half-open. */
export function placeLanes(
  items: { id: string; start: Date; end: Date }[],
  day: Date,
): Map<string, LanePlacement> {
  const clipped: LaneInterval[] = [];
  for (const item of items) {
    const range = clipToDay(item.start, item.end, day);
    if (range) {
      clipped.push({ id: item.id, start: range.start, end: range.end });
    }
  }
  const placed = new Map<string, LanePlacement>();
  const byStart = [...clipped].sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
  const clusters: LaneInterval[][] = [];
  let cluster: LaneInterval[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  for (const item of byStart) {
    if (cluster.length > 0 && item.start < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    } else {
      if (cluster.length > 0) {
        clusters.push(cluster);
      }
      cluster = [item];
      clusterEnd = item.end;
    }
  }
  if (cluster.length > 0) {
    clusters.push(cluster);
  }

  for (const group of clusters) {
    const laneEnds: number[] = [];
    const columnOf = new Map<string, number>();
    for (const item of group) {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[lane] = item.end;
      }
      columnOf.set(item.id, lane);
    }
    const columns = laneEnds.length;
    for (const item of group) {
      const column = columnOf.get(item.id) ?? 0;
      let span = 1;
      while (column + span < columns) {
        const nextLane = column + span;
        const blocked = group.some(
          (other) => columnOf.get(other.id) === nextLane && overlaps(item, other),
        );
        if (blocked) {
          break;
        }
        span += 1;
      }
      placed.set(item.id, { column, span, columns });
    }
  }
  return placed;
}

export function startsOnDay(start: Date, day: Date): boolean {
  return sameLocalDay(start, day);
}

export function endsOnDay(end: Date, day: Date): boolean {
  return sameLocalDay(new Date(end.getTime() - 1), day);
}

export function formatUsPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) {
    return "";
  }
  if (digits.length < 4) {
    return `(${digits}`;
  }
  if (digits.length < 7) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

export function hourLabel(hour: number): string {
  if (hour === 0) {
    return "12 AM";
  }
  if (hour < 12) {
    return `${hour} AM`;
  }
  if (hour === 12) {
    return "12 PM";
  }
  return `${hour - 12} PM`;
}

/** Merge caller options with the active calendar zone when web has one. */
export function calendarDateTimeFormatOptions(
  extra: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormatOptions {
  const zone = calendarTimeZone();
  return zone ? { ...extra, timeZone: zone } : { ...extra };
}

export function formatCalendarDate(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return date.toLocaleDateString([], calendarDateTimeFormatOptions(options));
}

export function formatCalendarTime(date: Date): string {
  return date.toLocaleTimeString([], calendarDateTimeFormatOptions({ hour: "numeric", minute: "2-digit" }));
}

export function formatCalendarDateTime(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return date.toLocaleString([], calendarDateTimeFormatOptions(options));
}

/** `YYYY-MM-DD` for `<input type="date">` in the active calendar zone. */
export function calendarDateInputValue(date: Date): string {
  const parts = zonedTime(date);
  return `${parts.year}-${pad2(parts.month + 1)}-${pad2(parts.day)}`;
}

/** `HH:mm` for `<input type="time">` in the active calendar zone. */
export function calendarTimeInputValue(date: Date): string {
  const parts = zonedTime(date);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** Interpret a date-input string as a calendar-zone civil date, keeping base's zone clock. */
export function arrivalFromDateInput(value: string, base: Date): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const baseParts = zonedTime(base);
  return instantFromZoned(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    baseParts.hour,
    baseParts.minute,
    0,
  );
}

/** Interpret a time-input string as a calendar-zone civil time on base's zone date. */
export function arrivalFromTimeInput(value: string, base: Date): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const baseParts = zonedTime(base);
  return instantFromZoned(baseParts.year, baseParts.month, baseParts.day, Number(match[1]), Number(match[2]), 0);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function zonedTime(date: Date): ZonedParts {
  const zone = calendarTimeZone();
  if (!zone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      weekday: date.getDay(),
    };
  }
  return readZonedParts(date, zone);
}

function readZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdays[parts.weekday ?? ""] ?? 0,
  };
}

function instantFromZoned(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const zone = calendarTimeZone();
  if (!zone) {
    return new Date(year, month, day, hour, minute, second, 0);
  }
  let millis = Date.UTC(year, month, day, hour, minute, second);
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = readZonedParts(new Date(millis), zone);
    const seen = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
    const want = Date.UTC(year, month, day, hour, minute, second);
    const delta = want - seen;
    if (delta === 0) {
      break;
    }
    millis += delta;
  }
  return new Date(millis);
}
