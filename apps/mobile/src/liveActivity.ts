import type {
  ActivityResponse,
  GeoCoordinate,
  LocationFix,
  MeterReading,
  RealtimeEnvelope,
  Sortie,
  SortieStop,
} from "@groundops/contracts";

export type AccountActivity = {
  location: LocationFix | null;
  sortie: Sortie | null;
  meter: MeterReading | null;
  asOf: string;
};

export const emptyActivity: AccountActivity = {
  location: null,
  sortie: null,
  meter: null,
  asOf: "",
};

export type EnvelopeApply = {
  state: AccountActivity;
  calendarChanged: boolean;
};

export function applySnapshot(activity: ActivityResponse): AccountActivity {
  return {
    location: activity.location,
    sortie: activity.sortie,
    meter: activity.meter,
    asOf: activity.asOf,
  };
}

/** Drops an envelope at or before the snapshot, and advances asOf when one is applied. */
export function applyEnvelope(state: AccountActivity, envelope: RealtimeEnvelope): EnvelopeApply {
  if (envelope.recordedAt <= state.asOf) {
    return { state, calendarChanged: false };
  }
  if (envelope.type === "location.updated") {
    return {
      state: { ...state, location: envelope.location, asOf: envelope.recordedAt },
      calendarChanged: false,
    };
  }
  if (envelope.type === "meter.updated") {
    return {
      state: { ...state, meter: envelope.meter, asOf: envelope.recordedAt },
      calendarChanged: false,
    };
  }
  if (envelope.type === "meter.cleared") {
    return {
      state: { ...state, meter: null, asOf: envelope.recordedAt },
      calendarChanged: false,
    };
  }
  const next = envelope.sortie;
  const inProgress = next.actualStart !== null && next.actualEnd === null;
  let sortie = state.sortie;
  if (state.sortie?.id === next.id) {
    sortie = inProgress ? next : null;
  } else if (inProgress) {
    sortie = next;
  }
  return {
    state: { ...state, sortie, asOf: envelope.recordedAt },
    calendarChanged: true,
  };
}

export function readRealtimeEnvelope(value: unknown): RealtimeEnvelope | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.userId !== "string" || typeof record.recordedAt !== "string") {
    return null;
  }
  if (record.type === "meter.cleared") {
    return { id: record.id, userId: record.userId, recordedAt: record.recordedAt, type: "meter.cleared" };
  }
  if (record.type === "location.updated" && isLocation(record.location)) {
    return {
      id: record.id,
      userId: record.userId,
      recordedAt: record.recordedAt,
      type: "location.updated",
      location: record.location,
    };
  }
  if (record.type === "meter.updated" && isMeter(record.meter)) {
    return {
      id: record.id,
      userId: record.userId,
      recordedAt: record.recordedAt,
      type: "meter.updated",
      meter: record.meter,
    };
  }
  if (record.type === "sortie.updated" && isSortieRecord(record.sortie)) {
    return {
      id: record.id,
      userId: record.userId,
      recordedAt: record.recordedAt,
      type: "sortie.updated",
      sortie: record.sortie,
    };
  }
  return null;
}

/**
 * The overview path is the route through every stop.
 * A remaining-leg reroute must not replace it. A partial start must not replace it either.
 */
export function overviewPathForUpload(
  reason: "guidance-start" | "stops-revised" | "tick" | "remaining-leg",
  firstStopPosition: number,
  path: GeoCoordinate[],
): GeoCoordinate[] | undefined {
  if (path.length < 2) {
    return undefined;
  }
  if (reason === "stops-revised") {
    return path;
  }
  if (reason === "guidance-start" && firstStopPosition === 0) {
    return path;
  }
  return undefined;
}

/** Identity of the drawn route. Vehicle movement is not part of it. */
export function overviewFrameKey(path: GeoCoordinate[], stops: GeoCoordinate[], hasVehicle: boolean): string {
  return JSON.stringify({
    path,
    stops,
    hasVehicle,
  });
}

export function overviewFitPoints(
  path: GeoCoordinate[],
  stops: GeoCoordinate[],
  vehicle: GeoCoordinate | null,
): GeoCoordinate[] {
  const points = [...path, ...stops];
  if (vehicle) {
    points.push(vehicle);
  }
  return points;
}

export function stopListKey(stops: SortieStop[]): string {
  return JSON.stringify(
    stops.map((stop) => [stop.label, stop.latitude, stop.longitude, stop.waitMinutes, stop.passenger]),
  );
}

export function reportDelayMs(lastSentAt: number | null, now: number, immediate: boolean): number {
  if (immediate || lastSentAt === null) {
    return 0;
  }
  return Math.max(0, 1000 - (now - lastSentAt));
}

function isLocation(value: unknown): value is LocationFix {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.latitude === "number" &&
    typeof record.longitude === "number" &&
    (record.accuracyMeters === null || typeof record.accuracyMeters === "number") &&
    typeof record.observedAt === "string"
  );
}

function isMeter(value: unknown): value is MeterReading {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.sortieId === "string" &&
    typeof record.milesTraveled === "number" &&
    typeof record.waitSeconds === "number" &&
    typeof record.totalCents === "number" &&
    typeof record.estimateCents === "number" &&
    typeof record.remainingMeters === "number" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.overviewPath)
  );
}

function isSortieRecord(value: unknown): value is Sortie {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && record.type === "task" && Array.isArray(record.stops);
}
