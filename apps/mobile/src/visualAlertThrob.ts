export const THROB_MS = 375;

export type AlertSide = "left" | "right" | "all";

export type AlertEdges = {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
};

export function normalizeThrobCount(count: number): number {
  if (!Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.floor(count));
}

/** Left turns light the left, top, and bottom edges. Right turns light the right, top, and bottom. */
export function alertEdges(side: AlertSide): AlertEdges {
  if (side === "left") {
    return { top: true, bottom: true, left: true, right: false };
  }
  if (side === "right") {
    return { top: true, bottom: true, left: false, right: true };
  }
  return { top: true, bottom: true, left: true, right: true };
}
