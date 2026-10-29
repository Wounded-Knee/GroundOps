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
  /** Client id for a create. A replay with the same id does not insert a second sortie. */
  id?: string;
  label: string;
  arrivalAt: string | null;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: SortieStopWrite[];
};

export function sameSortieWrite(
  stored: {
    label: string;
    arrivalAt: string;
    arrivalAuthored: boolean;
    passengerName: string | null;
    passengerPhone: string | null;
    stops: readonly SortieStopWrite[];
  },
  body: SortieWriteRequest,
): boolean {
  const arrivalAuthored = body.arrivalAt !== null;
  if (stored.label !== body.label.trim() || stored.arrivalAuthored !== arrivalAuthored) {
    return false;
  }
  if (arrivalAuthored && new Date(stored.arrivalAt).getTime() !== new Date(body.arrivalAt ?? "").getTime()) {
    return false;
  }
  if (stored.passengerName !== blankToNull(body.passengerName) || stored.passengerPhone !== blankToNull(body.passengerPhone)) {
    return false;
  }
  if (stored.stops.length !== body.stops.length) {
    return false;
  }
  return stored.stops.every((stop, index) => {
    const next = body.stops[index];
    return (
      next !== undefined &&
      stop.label === next.label.trim() &&
      stop.latitude === next.latitude &&
      stop.longitude === next.longitude &&
      stop.waitMinutes === next.waitMinutes &&
      stop.passenger === next.passenger
    );
  });
}

function blankToNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

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
  /** Client id. A repeat for the same driver is ignored. */
  id?: string;
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
