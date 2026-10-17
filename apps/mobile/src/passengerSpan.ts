/** Inclusive range of passenger-present stops, or null when none are present. */
export function passengerSpan(flags: readonly boolean[]): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  for (let index = 0; index < flags.length; index += 1) {
    if (!flags[index]) {
      continue;
    }
    if (start === -1) {
      start = index;
    }
    end = index;
  }
  if (start === -1) {
    return null;
  }
  return { start, end };
}

/**
 * Toggle one stop without opening a gap.
 * A stop outside the span extends it through every stop in between.
 * An endpoint shrinks the span. An interior stop stays on.
 */
export function applyPassengerToggle(flags: readonly boolean[], index: number): boolean[] {
  if (index < 0 || index >= flags.length) {
    return flags.slice();
  }
  const span = passengerSpan(flags);
  if (!span) {
    const next = flags.slice();
    next[index] = true;
    return next;
  }
  if (!flags[index]) {
    const from = Math.min(span.start, index);
    const to = Math.max(span.end, index);
    return flags.map((flag, flagIndex) => (flagIndex >= from && flagIndex <= to ? true : flag));
  }
  if (index === span.start || index === span.end) {
    const next = flags.slice();
    next[index] = false;
    return next;
  }
  return flags.slice();
}

/** Fill from the first passenger stop through the last so a reorder cannot leave a gap. */
export function repairPassengerSpan(flags: readonly boolean[]): boolean[] {
  const span = passengerSpan(flags);
  if (!span) {
    return flags.slice();
  }
  return flags.map((flag, index) => (index >= span.start && index <= span.end ? true : flag));
}
