import type { GeoCoordinate } from "./routing";

export type AvailabilityResponse = {
  asOf: string;
  /** The driver's choice. */
  available: boolean;
  /** True when the choice is available and the check-in is at most five minutes old. */
  current: boolean;
};

export type SetAvailabilityRequest = {
  available: boolean;
};

export const availabilityThresholdMaxMinutes = 120;

export type AvailabilitySettings = {
  thresholdMinutes: number;
  autoSetUnavailable: boolean;
  autoSetAvailable: boolean;
  geofence: GeoCoordinate[];
};

export const defaultAvailabilitySettings: AvailabilitySettings = {
  thresholdMinutes: 15,
  autoSetUnavailable: true,
  autoSetAvailable: true,
  geofence: [],
};

/** A span the server treated the driver as available. `end` is null while that is still true. */
export type AvailabilityInterval = {
  start: string;
  end: string | null;
};
