export type CalendarScope = "month" | "week" | "day";

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
