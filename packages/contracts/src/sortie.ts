import type { AvailabilityInterval } from "./availability";
import type { GeoCoordinate } from "./routing";

/** Platform sortie type this slice authors. */
export const taskSortieType = "task";

export type Driver = {
  id: string;
  userId: string;
};

export type SortieStopWrite = {
  label: string;
  latitude: number;
  longitude: number;
  waitMinutes: number;
  passenger: boolean;
};

export type SortieStop = SortieStopWrite & {
  actualArrivedAt: string | null;
  actualDepartedAt: string | null;
};

export type Sortie = {
  id: string;
  type: typeof taskSortieType;
  label: string;
  arrivalAt: string;
  arrivalAuthored: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  departureAddress: string;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: SortieStop[];
};

export type SortieWriteRequest = {
  label: string;
  arrivalAt: string | null;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: SortieStopWrite[];
};

/** A draft judged against the driver's open sorties. `sortieId` is set while revising. */
export type SortiePreviewRequest = SortieWriteRequest & {
  sortieId: string | null;
};

export type EndangeredSortie = {
  id: string;
  label: string;
};

export type SortiePreviewResponse = {
  endangered: EndangeredSortie[];
};

export type LocationObservationRequest = {
  observedAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  sortieId?: string | null;
};

export type CalendarResponse = {
  sorties: Sortie[];
  availability: AvailabilityInterval[];
};

/** Driver-owned meter rates. Money is integer US cents. */
export type Tariff = {
  flagCents: number;
  perMileCents: number;
  perWaitMinuteCents: number;
};

export type ReplaceTariffRequest = Tariff;

export type TariffResponse = Tariff;

export const defaultTariff: Tariff = {
  flagCents: 300,
  perMileCents: 250,
  perWaitMinuteCents: 40,
};

export type SortieDrivingRouteRequest = {
  origin: GeoCoordinate;
  firstStopPosition: number;
};
