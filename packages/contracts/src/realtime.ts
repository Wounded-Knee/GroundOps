import type { GeoCoordinate } from "./routing";
import type { Sortie } from "./sortie";

/** Live fanout subject. The bus carries this envelope; it is not a domain event. */
export const realtimeSubject = "realtime.broadcast";

export type LocationFix = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  observedAt: string;
};

export type MeterReading = {
  sortieId: string;
  milesTraveled: number;
  waitSeconds: number;
  totalCents: number;
  estimateCents: number;
  remainingMeters: number;
  overviewPath: GeoCoordinate[];
  updatedAt: string;
};

export type ReplaceMeterReadingRequest = {
  sortieId: string;
  milesTraveled: number;
  waitSeconds: number;
  totalCents: number;
  estimateCents: number;
  remainingMeters: number;
  overviewPath?: GeoCoordinate[];
};

export type ActivityResponse = {
  asOf: string;
  location: LocationFix | null;
  sortie: Sortie | null;
  meter: MeterReading | null;
};

type RealtimeBase = {
  id: string;
  userId: string;
  recordedAt: string;
};

export type RealtimeEnvelope =
  | (RealtimeBase & { type: "sortie.updated"; sortie: Sortie })
  | (RealtimeBase & { type: "location.updated"; location: LocationFix })
  | (RealtimeBase & { type: "meter.updated"; meter: MeterReading })
  | (RealtimeBase & { type: "meter.cleared" })
  | (RealtimeBase & { type: "availability.updated"; available: boolean; current: boolean });
