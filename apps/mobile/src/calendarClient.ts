import type {
  CalendarResponse,
  Driver,
  LocationObservationRequest,
  Sortie,
  SortieStop,
  SortieWriteRequest,
  Tariff,
} from "@groundops/contracts";
import { taskSortieType } from "@groundops/contracts";

export async function ensureCurrentDriver(
  apiUrl: string,
  token: string,
): Promise<Driver | "unauthorized" | "unreachable"> {
  try {
    const response = await fetch(`${apiUrl}/drivers/current`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (!response.ok) {
      return "unreachable";
    }
    const body: unknown = await response.json();
    return isDriver(body) ? body : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function requestCalendar(
  apiUrl: string,
  token: string,
  from: string,
  to: string,
): Promise<CalendarResponse | "unauthorized" | "unreachable" | "rejected"> {
  try {
    const url = new URL(`${apiUrl}/calendar`);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (response.status === 400 || response.status === 409) {
      return "rejected";
    }
    if (!response.ok) {
      return "unreachable";
    }
    const body: unknown = await response.json();
    return isCalendarResponse(body) ? body : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function authorSortie(
  apiUrl: string,
  token: string,
  body: SortieWriteRequest,
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected" | "no-location"> {
  return writeSortie(apiUrl, token, "POST", "/sorties", body);
}

export async function reviseSortie(
  apiUrl: string,
  token: string,
  sortieId: string,
  body: SortieWriteRequest,
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected" | "no-location"> {
  return writeSortie(apiUrl, token, "PATCH", `/sorties/${sortieId}`, body);
}

export async function commenceSortie(
  apiUrl: string,
  token: string,
  sortieId: string,
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected" | "no-location"> {
  try {
    const response = await fetch(`${apiUrl}/sorties/${sortieId}/commence`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      return "unauthorized";
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
  } catch {
    return "unreachable";
  }
}

async function writeSortie(
  apiUrl: string,
  token: string,
  method: "POST" | "PATCH",
  path: string,
  body: SortieWriteRequest,
): Promise<Sortie | "unauthorized" | "unreachable" | "rejected" | "no-location"> {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      return "unauthorized";
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
  } catch {
    return "unreachable";
  }
}

function isCalendarResponse(value: unknown): value is CalendarResponse {
  if (typeof value !== "object" || value === null || !("sorties" in value)) {
    return false;
  }
  const sorties = value.sorties;
  return Array.isArray(sorties) && sorties.every(isSortie);
}

function isDriver(value: unknown): value is Driver {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && record.id.length > 0 && typeof record.userId === "string";
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
): Promise<"ok" | "unauthorized" | "rejected"> {
  try {
    const response = await fetch(`${apiUrl}/location-observations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (response.status === 204) {
      return "ok";
    }
    return "rejected";
  } catch {
    return "rejected";
  }
}

export async function requestTariff(
  apiUrl: string,
  token: string,
): Promise<Tariff | "unauthorized" | "unreachable" | "no-driver"> {
  try {
    const response = await fetch(`${apiUrl}/fare-rates`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (response.status === 409) {
      return "no-driver";
    }
    if (!response.ok) {
      return "unreachable";
    }
    const body: unknown = await response.json();
    return isTariff(body) ? body : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function saveTariff(
  apiUrl: string,
  token: string,
  tariff: Tariff,
): Promise<Tariff | "unauthorized" | "unreachable" | "rejected" | "no-driver"> {
  try {
    const response = await fetch(`${apiUrl}/fare-rates`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(tariff),
    });
    if (response.status === 401) {
      return "unauthorized";
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
  } catch {
    return "unreachable";
  }
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
    typeof record.passenger === "boolean"
  );
}
