export const THROB_MS = 750;

export function normalizeThrobCount(count: number): number {
  if (!Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.floor(count));
}
