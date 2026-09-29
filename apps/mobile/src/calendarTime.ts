export type CalendarScope = "month" | "week" | "day";

export const hourHeight = 64;
export const snapMinutes = 15;

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

export function addMinutes(date: Date, minutes: number): Date {
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

export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -day.getDay());
}

export function sameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
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
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { from: gridStart, to: addDays(startOfWeek(last), 7) };
}

export function shiftAnchor(scope: CalendarScope, anchor: Date, direction: -1 | 1): Date {
  if (scope === "day") {
    return addDays(startOfDay(anchor), direction);
  }
  if (scope === "week") {
    return addDays(startOfWeek(anchor), direction * 7);
  }
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

export function periodLabel(scope: CalendarScope, anchor: Date): string {
  if (scope === "day") {
    return anchor.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  if (scope === "week") {
    const from = startOfWeek(anchor);
    const until = addDays(from, 6);
    const sameYear = from.getFullYear() === until.getFullYear();
    const start = from.toLocaleDateString([], { month: "short", day: "numeric" });
    const end = until.toLocaleDateString([], sameYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
    return sameYear ? `${start} – ${end}` : `${from.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} – ${end}`;
  }
  return anchor.toLocaleDateString([], { month: "long", year: "numeric" });
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
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86_400_000);
}

export function minuteDeltaFromPixels(dy: number): number {
  return Math.round(((dy / hourHeight) * 60) / snapMinutes) * snapMinutes;
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
  return new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), base.getHours(), base.getMinutes(), 0, 0);
}

export function withPickedTime(base: Date, picked: Date): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), picked.getHours(), picked.getMinutes(), 0, 0);
}

export function hourSlot(day: Date, hour: number): Interval {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 60 * 60 * 1000) };
}

export function defaultInterval(scope: CalendarScope, anchor: Date): Interval {
  const day = scope === "month" ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : startOfDay(anchor);
  return hourSlot(day, 9);
}

export function blockOnDay(start: Date, end: Date, day: Date): { top: number; height: number } | null {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  if (end.getTime() <= dayStart.getTime() || start.getTime() >= dayEnd.getTime()) {
    return null;
  }
  const visibleStart = start.getTime() < dayStart.getTime() ? dayStart : start;
  const visibleEnd = end.getTime() > dayEnd.getTime() ? dayEnd : end;
  const startMinutes = visibleStart.getTime() === dayStart.getTime() ? 0 : visibleStart.getHours() * 60 + visibleStart.getMinutes();
  const endMinutes = visibleEnd.getTime() === dayEnd.getTime() ? 24 * 60 : visibleEnd.getHours() * 60 + visibleEnd.getMinutes();
  const top = (startMinutes / 60) * hourHeight;
  const height = Math.max(((endMinutes - startMinutes) / 60) * hourHeight, 32);
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
