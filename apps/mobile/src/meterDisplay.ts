import type { Tariff } from "@groundops/contracts";

export type MeterDisplay = {
  milesTraveled: number;
  waitSeconds: number;
  remainingMeters: number;
  baselineRemainingMeters: number;
  estimatedDurationSeconds: number;
  turnRemainingMeters: number;
  turnBaselineMeters: number;
  tariff: Tariff | null;
  canArrive: boolean;
  dwelling: boolean;
  waitEndsAt: number | null;
  meterPaused: boolean;
  flashFare: boolean;
  showOnward: boolean;
  showCommence: boolean;
  pendingNextLeg: boolean;
  flagDropped: boolean;
};
