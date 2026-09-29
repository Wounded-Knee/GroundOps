import {
  maneuvers,
  type DrivingRoute,
  type DrivingRouteRequest,
  type GeoCoordinate,
  type Maneuver,
  type PlaceSuggestion,
  type PlaceSuggestionsRequest,
  type PlaceSuggestionsResponse,
  type RouteStep,
} from "@groundops/contracts";

const maneuverSet = new Set<string>(maneuvers);

export async function requestPlaceSuggestions(
  apiUrl: string,
  token: string,
  query: string,
  bias: GeoCoordinate | null,
): Promise<PlaceSuggestion[] | "failed" | "unauthorized"> {
  const body: PlaceSuggestionsRequest = bias ? { query, bias } : { query };
  try {
    const response = await fetch(`${apiUrl}/place-suggestions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (!response.ok) {
      return "failed";
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.suggestions)) {
      return "failed";
    }
    const suggestions: PlaceSuggestion[] = [];
    for (const suggestion of payload.suggestions) {
      const parsed = readSuggestion(suggestion);
      if (parsed) {
        suggestions.push(parsed);
      }
      if (suggestions.length === 5) {
        break;
      }
    }
    return suggestions;
  } catch {
    return "failed";
  }
}

export async function requestDrivingRoute(
  apiUrl: string,
  token: string,
  origin: GeoCoordinate,
  destination: GeoCoordinate,
): Promise<DrivingRoute | "failed" | "unauthorized"> {
  const body: DrivingRouteRequest = { origin, destination };
  try {
    const response = await fetch(`${apiUrl}/driving-routes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (!response.ok) {
      return "failed";
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return "failed";
    }
    const route = readRoute(payload.route);
    return route ?? "failed";
  } catch {
    return "failed";
  }
}

export async function requestSortieDrivingRoute(
  apiUrl: string,
  token: string,
  sortieId: string,
  origin: GeoCoordinate,
  firstStopPosition: number,
): Promise<DrivingRoute | "failed" | "unauthorized"> {
  try {
    const response = await fetch(`${apiUrl}/sorties/${sortieId}/driving-route`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ origin, firstStopPosition }),
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (!response.ok) {
      return "failed";
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return "failed";
    }
    const route = readRoute(payload.route);
    return route ?? "failed";
  } catch {
    return "failed";
  }
}

function readSuggestion(value: unknown): PlaceSuggestion | null {
  if (!isRecord(value) || typeof value.label !== "string" || value.label.length === 0) {
    return null;
  }
  const coordinate = readCoordinate(value);
  if (!coordinate) {
    return null;
  }
  const name = typeof value.name === "string" && value.name.length > 0 ? value.name : value.label;
  const detail = typeof value.detail === "string" ? value.detail : "";
  return { label: value.label, name, detail, ...coordinate };
}

function readRoute(value: unknown): DrivingRoute | null {
  if (!isRecord(value) || !Array.isArray(value.steps) || value.steps.length === 0) {
    return null;
  }
  const path = readPath(value.path);
  if (!path || path.length === 0 || !isMeters(value.distanceMeters) || !isMeters(value.durationSeconds)) {
    return null;
  }
  const steps: RouteStep[] = [];
  for (const step of value.steps) {
    const parsed = readStep(step);
    if (!parsed) {
      return null;
    }
    steps.push(parsed);
  }
  return {
    distanceMeters: value.distanceMeters,
    durationSeconds: value.durationSeconds,
    path,
    steps,
  };
}

function readStep(value: unknown): RouteStep | null {
  if (!isRecord(value) || typeof value.instruction !== "string" || !isManeuver(value.maneuver)) {
    return null;
  }
  const path = readPath(value.path);
  if (!path || path.length === 0 || !isMeters(value.distanceMeters) || !isMeters(value.durationSeconds)) {
    return null;
  }
  return {
    instruction: value.instruction,
    maneuver: value.maneuver,
    distanceMeters: value.distanceMeters,
    durationSeconds: value.durationSeconds,
    path,
  };
}

function readPath(value: unknown): GeoCoordinate[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const path: GeoCoordinate[] = [];
  for (const point of value) {
    const coordinate = readCoordinate(point);
    if (!coordinate) {
      return null;
    }
    path.push(coordinate);
  }
  return path;
}

function readCoordinate(value: unknown): GeoCoordinate | null {
  if (!isRecord(value) || typeof value.latitude !== "number" || typeof value.longitude !== "number") {
    return null;
  }
  if (!Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) {
    return null;
  }
  return { latitude: value.latitude, longitude: value.longitude };
}

function isManeuver(value: unknown): value is Maneuver {
  return typeof value === "string" && maneuverSet.has(value);
}

function isMeters(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
