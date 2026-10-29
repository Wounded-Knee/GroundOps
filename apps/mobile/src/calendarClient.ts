import type {
  ActivityResponse,
  CalendarResponse,
  Driver,
  LocationObservationRequest,
  MeterReading,
  ReplaceMeterReadingRequest,
  Sortie,
  SortiePreviewRequest,
  SortiePreviewResponse,
  SortieStop,
  SortieWriteRequest,
  Tariff,
} from "@groundops/contracts";
import { taskSortieType } from "@groundops/contracts";
import { fetchAuthorized } from "./authorizedFetch";
import { parseAvailabilityIntervals } from "./calendarTime";

export async function ensureCurrentDriver(
  apiUrl: string,
  token: string,
): Promise<Driver | "unauthorized" | "unreachable"> {
  const response = await fetchAuthorized(`${apiUrl}/drivers/current`, token, { method: "POST" });
  if (typeof response === "string") {
    return response;
  }
  if (!response.ok) {
    return "unreachable";
  }
  const body: unknown = await response.json();
  return isDriver(body) ? body : "unreachable";
}

export async function requestCalendar(
  apiUrl: string,
  token: string,
  from: string,
  to: string,
): Promise<CalendarResponse | "unauthorized" | "unreachable" | "rejected"> {
  const url = new URL(`${apiUrl}/calendar`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const response = await fetchAuthorized(url, token);
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  if (response.status === 400 || response.status === 409) {
    return "rejected";
  }
  if (!response.ok) {
    return "unreachable";
  }
  const body: unknown = await response.json();
  return isCalendarResponse(body) ? body : "unreachable";
}

export async function authorSortie(
  apiUrl: string,
  token: string,
  body: SortieWriteRequest,
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected" | "no-location" | "unavailable"> {
  return writeSortie(apiUrl, token, "POST", "/sorties", body);
}

export async function reviseSortie(
  apiUrl: string,
  token: string,
  sortieId: string,
  body: SortieWriteRequest,
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected" | "no-location" | "unavailable"> {
  return writeSortie(apiUrl, token, "PATCH", `/sorties/${sortieId}`, body);
}

export function scheduleConflictMessage(labels: string[]): string | null {
  if (labels.length === 0) {
    return null;
  }
  return `This plan conflicts with ${labels.join(", ")}.`;
}

export async function previewSortie(
  apiUrl: string,
  token: string,
  body: SortiePreviewRequest,
): Promise<SortiePreviewResponse | "unauthorized" | "unreachable" | "rejected" | "no-location"> {
  const response = await fetchAuthorized(`${apiUrl}/sorties/preview`, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  if (response.status === 409 && (await readError(response)) === "no location") {
    return "no-location";
  }
  if (response.status === 400 || response.status === 409) {
    return "rejected";
  }
  if (!response.ok) {
    return "unreachable";
  }
  const parsed: unknown = await response.json();
  return isPreviewResponse(parsed) ? parsed : "unreachable";
}

export async function commenceSortie(
  apiUrl: string,
  token: string,
  sortieId: string,
  options?: { guidance?: boolean },
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected" | "no-location" | "unavailable"> {
  const guidance = options?.guidance === true;
  const response = await fetchAuthorized(`${apiUrl}/sorties/${sortieId}/commence`, token, {
    method: "POST",
    ...(guidance
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ guidance: true }) }
      : {}),
  });
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
    if (response.status === 409 && (await readError(response)) === "no location") {
      return "no-location";
    }
    if (response.status === 400 || response.status === 404 || response.status === 409 || response.status === 503) {
      return "rejected";
    }
    if (!response.ok) {
      return "unreachable";
    }
  const parsed: unknown = await response.json();
  return isSortie(parsed) ? parsed : "unreachable";
}

export async function completeSortie(
  apiUrl: string,
  token: string,
  sortieId: string,
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected"> {
  const response = await fetchAuthorized(`${apiUrl}/sorties/${sortieId}/complete`, token, { method: "POST" });
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  if (response.status === 400 || response.status === 404 || response.status === 409) {
    return "rejected";
  }
  if (!response.ok) {
    return "unreachable";
  }
  const parsed: unknown = await response.json();
  return isSortie(parsed) ? parsed : "unreachable";
}

export async function assertStopArrival(
  apiUrl: string,
  token: string,
  sortieId: string,
  position: number,
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected"> {
  return postStopAction(apiUrl, token, sortieId, position, "arrive");
}

export async function extendStopWait(
  apiUrl: string,
  token: string,
  sortieId: string,
  position: number,
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected" | "no-location" | "unavailable"> {
  const response = await fetchAuthorized(
    `${apiUrl}/sorties/${sortieId}/stops/${position}/extend-wait`,
    token,
    { method: "POST" },
  );
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
    if (response.status === 409 && (await readError(response)) === "no location") {
      return "no-location";
    }
    if (response.status === 400 || response.status === 404 || response.status === 409 || response.status === 503) {
      return "rejected";
    }
    if (!response.ok) {
      return "unreachable";
    }
  const parsed: unknown = await response.json();
  return isSortie(parsed) ? parsed : "unreachable";
}

async function postStopAction(
  apiUrl: string,
  token: string,
  sortieId: string,
  position: number,
  action: "arrive",
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected"> {
  const response = await fetchAuthorized(`${apiUrl}/sorties/${sortieId}/stops/${position}/${action}`, token, {
    method: "POST",
  });
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  if (response.status === 400 || response.status === 404 || response.status === 409) {
    return "rejected";
  }
  if (!response.ok) {
    return "unreachable";
  }
  const parsed: unknown = await response.json();
  return isSortie(parsed) ? parsed : "unreachable";
}

async function writeSortie(
  apiUrl: string,
  token: string,
  method: "POST" | "PATCH",
  path: string,
  body: SortieWriteRequest,
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected" | "no-location" | "unavailable"> {
  const response = await fetchAuthorized(`${apiUrl}${path}`, token, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  if (response.status === 409 && (await readError(response)) === "no location") {
    return "no-location";
  }
  if (response.status === 503) {
    return "unavailable";
  }
  if (response.status === 400 || response.status === 404 || response.status === 409) {
    return "rejected";
  }
  if (!response.ok) {
    return "unreachable";
  }
  const parsed: unknown = await response.json();
  return isSortie(parsed) ? parsed : "unreachable";
}

function isCalendarResponse(value: unknown): value is CalendarResponse {
  if (typeof value !== "object" || value === null || !("sorties" in value) || !("availability" in value)) {
    return false;
  }
  const sorties = value.sorties;
  const availability = parseAvailabilityIntervals(value.availability);
  return Array.isArray(sorties) && sorties.every(isSortie) && availability !== null;
}

function isDriver(value: unknown): value is Driver {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && record.id.length > 0 && typeof record.userId === "string";
}

function isPreviewResponse(value: unknown): value is SortiePreviewResponse {
  if (typeof value !== "object" || value === null || !("endangered" in value)) {
    return false;
  }
  const endangered = value.endangered;
  return (
    Array.isArray(endangered) &&
    endangered.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "label" in item &&
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.label === "string",
    )
  );
}

function isSortie(value: unknown): value is Sortie {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    record.type === taskSortieType &&
    typeof record.label === "string" &&
    typeof record.arrivalAt === "string" &&
    typeof record.arrivalAuthored === "boolean" &&
    typeof record.scheduledStart === "string" &&
    typeof record.scheduledEnd === "string" &&
    (record.actualStart === null || typeof record.actualStart === "string") &&
    (record.actualEnd === null || typeof record.actualEnd === "string") &&
    typeof record.departureAddress === "string" &&
    (record.passengerName === null || typeof record.passengerName === "string") &&
    (record.passengerPhone === null || typeof record.passengerPhone === "string") &&
    Array.isArray(record.stops) &&
    record.stops.every(isStop)
  );
}

export async function reportLocationObservation(
  apiUrl: string,
  token: string,
  body: LocationObservationRequest,
): Promise<"ok" | "unauthorized" | "unreachable" | "rejected"> {
  const response = await fetchAuthorized(`${apiUrl}/location-observations`, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  return response.status === 204 ? "ok" : "rejected";
}

export async function requestTariff(
  apiUrl: string,
  token: string,
): Promise<Tariff | "unauthorized" | "unreachable" | "no-driver"> {
  const response = await fetchAuthorized(`${apiUrl}/fare-rates`, token);
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  if (response.status === 409) {
    return "no-driver";
  }
  if (!response.ok) {
    return "unreachable";
  }
  const body: unknown = await response.json();
  return isTariff(body) ? body : "unreachable";
}

export async function saveTariff(
  apiUrl: string,
  token: string,
  tariff: Tariff,
): Promise<Tariff | "unauthorized" | "unreachable" | "rejected" | "no-driver"> {
  const response = await fetchAuthorized(`${apiUrl}/fare-rates`, token, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(tariff),
  });
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  if (response.status === 409) {
    return "no-driver";
  }
  if (response.status === 400) {
    return "rejected";
  }
  if (!response.ok) {
    return "unreachable";
  }
  const body: unknown = await response.json();
  return isTariff(body) ? body : "unreachable";
}

export async function readActivity(
  apiUrl: string,
  token: string,
): Promise<ActivityResponse | "unauthorized" | "unreachable"> {
  const response = await fetchAuthorized(`${apiUrl}/activity`, token);
  if (typeof response === "string") {
    return response;
  }
  if (!response.ok) {
    return "unreachable";
  }
  const body: unknown = await response.json();
  return isActivity(body) ? body : "unreachable";
}

export async function replaceMeterReading(
  apiUrl: string,
  token: string,
  body: ReplaceMeterReadingRequest,
): Promise<MeterReading | "unauthorized" | "unreachable" | "rejected"> {
  const response = await fetchAuthorized(`${apiUrl}/meter-reading`, token, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  if (response.status === 400 || response.status === 409) {
    return "rejected";
  }
  if (!response.ok) {
    return "unreachable";
  }
  const parsed: unknown = await response.json();
  return isMeterReading(parsed) ? parsed : "unreachable";
}

export async function clearMeterReading(
  apiUrl: string,
  token: string,
): Promise<"ok" | "unauthorized" | "unreachable" | "rejected"> {
  const response = await fetchAuthorized(`${apiUrl}/meter-reading`, token, { method: "DELETE" });
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  if (response.status === 409) {
    return "rejected";
  }
  if (response.status !== 204 && !response.ok) {
    return "unreachable";
  }
  return "ok";
}

function isTariff(value: unknown): value is Tariff {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Number.isInteger(record.flagCents) &&
    Number(record.flagCents) >= 0 &&
    Number.isInteger(record.perMileCents) &&
    Number(record.perMileCents) >= 0 &&
    Number.isInteger(record.perWaitMinuteCents) &&
    Number(record.perWaitMinuteCents) >= 0
  );
}

async function readError(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("error" in body)) {
      return null;
    }
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

function isActivity(value: unknown): value is ActivityResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.asOf !== "string") {
    return false;
  }
  const locationOk = record.location === null || isLocationFix(record.location);
  const sortieOk = record.sortie === null || isSortie(record.sortie);
  const meterOk = record.meter === null || isMeterReading(record.meter);
  return locationOk && sortieOk && meterOk;
}

function isLocationFix(value: unknown): boolean {
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

function isMeterReading(value: unknown): value is MeterReading {
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
    Array.isArray(record.overviewPath) &&
    record.overviewPath.every(isCoordinate)
  );
}

function isCoordinate(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.latitude === "number" && typeof record.longitude === "number";
}

function isStop(value: unknown): value is SortieStop {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.label === "string" &&
    record.label.length > 0 &&
    typeof record.latitude === "number" &&
    Number.isFinite(record.latitude) &&
    typeof record.longitude === "number" &&
    Number.isFinite(record.longitude) &&
    Number.isInteger(record.waitMinutes) &&
    Number(record.waitMinutes) >= 0 &&
    typeof record.passenger === "boolean" &&
    (record.actualArrivedAt === null || typeof record.actualArrivedAt === "string") &&
    (record.actualDepartedAt === null || typeof record.actualDepartedAt === "string")
  );
}
