import type { AvailabilityResponse, SetAvailabilityRequest } from "@groundops/contracts";

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

function isAvailability(value: unknown): value is AvailabilityResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.asOf === "string" && typeof record.available === "boolean" && typeof record.current === "boolean";
}
