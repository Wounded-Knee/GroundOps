import type { AvailabilityResponse, AvailabilitySettings, SetAvailabilityRequest } from "@groundops/contracts";

export async function readAvailability(
  apiUrl: string,
  token: string,
): Promise<AvailabilityResponse | "unauthorized" | "unreachable"> {
  return requestAvailability(apiUrl, token, "GET", "/availability");
}

export async function putAvailability(
  apiUrl: string,
  token: string,
  available: boolean,
): Promise<AvailabilityResponse | "unauthorized" | "unreachable"> {
  const body: SetAvailabilityRequest = { available };
  return requestAvailability(apiUrl, token, "PUT", "/availability", body);
}

export async function checkInAvailability(
  apiUrl: string,
  token: string,
): Promise<AvailabilityResponse | "unauthorized" | "unreachable"> {
  return requestAvailability(apiUrl, token, "POST", "/availability/check-in");
}

export async function readAvailabilitySettings(
  apiUrl: string,
  token: string,
): Promise<AvailabilitySettings | "unauthorized" | "unreachable"> {
  try {
    const response = await fetch(`${apiUrl}/availability/settings`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (!response.ok) {
      return "unreachable";
    }
    const payload: unknown = await response.json();
    return isAvailabilitySettings(payload) ? payload : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function saveAvailabilitySettings(
  apiUrl: string,
  token: string,
  settings: AvailabilitySettings,
): Promise<AvailabilitySettings | "unauthorized" | "unreachable" | "rejected"> {
  try {
    const response = await fetch(`${apiUrl}/availability/settings`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(settings),
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (response.status === 400) {
      return "rejected";
    }
    if (!response.ok) {
      return "unreachable";
    }
    const payload: unknown = await response.json();
    return isAvailabilitySettings(payload) ? payload : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function requestAvailability(
  apiUrl: string,
  token: string,
  method: "GET" | "PUT" | "POST",
  path: string,
  body?: SetAvailabilityRequest,
): Promise<AvailabilityResponse | "unauthorized" | "unreachable"> {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (!response.ok) {
      return "unreachable";
    }
    const payload: unknown = await response.json();
    return isAvailability(payload) ? payload : "unreachable";
  } catch {
    return "unreachable";
  }
}

function isAvailabilitySettings(value: unknown): value is AvailabilitySettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Number.isInteger(record.thresholdMinutes) &&
    typeof record.autoSetUnavailable === "boolean" &&
    typeof record.autoSetAvailable === "boolean" &&
    Array.isArray(record.geofence) &&
    record.geofence.every((point) => {
      if (typeof point !== "object" || point === null) {
        return false;
      }
      const coordinate = point as Record<string, unknown>;
      return typeof coordinate.latitude === "number" && typeof coordinate.longitude === "number";
    })
  );
}

function isAvailability(value: unknown): value is AvailabilityResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.asOf === "string" && typeof record.available === "boolean" && typeof record.current === "boolean";
}
