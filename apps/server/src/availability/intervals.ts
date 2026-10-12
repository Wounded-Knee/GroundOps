export type AvailabilityCurrentEvent = {
  recordedAt: Date;
  current: boolean;
};

/**
 * Spans where the server treated the driver as available.
 * `priorCurrent` is the latest event before `from`. Events are those inside `[from, to)`.
 * A lapse (`current` false while the choice stays available) closes the span at that event.
 * A still-current record leaves `end` null.
 */
export function foldCurrentAvailability(
  priorCurrent: boolean,
  events: AvailabilityCurrentEvent[],
  from: Date,
): { start: Date; end: Date | null }[] {
  let current = priorCurrent;
  let openStart: Date | null = current ? from : null;
  const intervals: { start: Date; end: Date | null }[] = [];
  for (const event of events) {
    if (event.recordedAt.getTime() < from.getTime() || event.current === current) {
      continue;
    }
    if (event.current) {
      current = true;
      openStart = event.recordedAt;
      continue;
    }
    if (openStart && event.recordedAt.getTime() > openStart.getTime()) {
      intervals.push({ start: openStart, end: event.recordedAt });
    }
    current = false;
    openStart = null;
  }
  if (current && openStart) {
    intervals.push({ start: openStart, end: null });
  }
  return intervals;
}
