export type StopDrag = {
  index: number;
  dy: number;
  target: number;
};

export function moveStop<T>(stops: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= stops.length || to >= stops.length) {
    return stops;
  }
  const next = stops.slice();
  const moved = next[from];
  if (moved === undefined) {
    return stops;
  }
  next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function indexAtOffset(heights: readonly number[], from: number, dy: number, count: number): number {
  if (count <= 1) {
    return 0;
  }
  const safe = Array.from({ length: count }, (_, index) => {
    const height = heights[index] ?? 0;
    return height > 0 ? height : 64;
  });
  const fromTop = safe.slice(0, from).reduce((sum, height) => sum + height, 0);
  const center = fromTop + dy + (safe[from] ?? 64) / 2;
  let cursor = 0;
  for (let index = 0; index < safe.length; index += 1) {
    const height = safe[index] ?? 64;
    if (center < cursor + height) {
      return index;
    }
    cursor += height;
  }
  return safe.length - 1;
}

export function rowTranslate(index: number, drag: StopDrag | null, heights: readonly number[]): number {
  if (!drag) {
    return 0;
  }
  if (index === drag.index) {
    return drag.dy;
  }
  const measured = heights[drag.index] ?? 0;
  const span = measured > 0 ? measured : 64;
  if (drag.index < drag.target && index > drag.index && index <= drag.target) {
    return -span;
  }
  if (drag.target < drag.index && index >= drag.target && index < drag.index) {
    return span;
  }
  return 0;
}
