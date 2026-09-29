import type { DrivingRoute, GeoCoordinate, Maneuver, PlaceSuggestion, RouteStep } from "@groundops/contracts";
import { decodePolyline } from "./polyline.js";

const placesAutocompleteUrl = "https://places.googleapis.com/v1/places:autocomplete";
const routesUrl = "https://routes.googleapis.com/directions/v2:computeRoutes";
const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
const suggestionLimit = 5;
const biasRadiusMeters = 50_000;

const durationFieldMask = "routes.duration";

const routeFieldMask = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.polyline.encodedPolyline",
  "routes.legs.steps.distanceMeters",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.polyline.encodedPolyline",
  "routes.legs.steps.navigationInstruction",
  "routes.legs.steps.startLocation",
  "routes.legs.steps.endLocation",
].join(",");

export type MapFetch = (input: string, init: RequestInit) => Promise<Response>;

type GoogleClient = {
  fetch: MapFetch;
  apiKey: string;
};

export async function suggestPlaces(
  query: string,
  bias: GeoCoordinate | null,
  client: Partial<GoogleClient> = {},
): Promise<PlaceSuggestion[] | "failed"> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const resolved = resolveClient(client);
  if (resolved === "failed") {
    return "failed";
  }

  const sessionToken = crypto.randomUUID();
  let autocomplete: unknown;
  try {
    const response = await resolved.fetch(placesAutocompleteUrl, {
      method: "POST",
      headers: googleHeaders(resolved.apiKey),
      body: JSON.stringify(autocompleteBody(trimmed, bias, sessionToken)),
    });
    if (!response.ok) {
      return "failed";
    }
    autocomplete = await response.json();
  } catch {
    return "failed";
  }

  const located = await Promise.all(
    readPredictions(autocomplete).map((prediction) => locatePrediction(resolved, prediction, sessionToken)),
  );
  return located.filter((suggestion): suggestion is PlaceSuggestion => suggestion !== null).slice(0, suggestionLimit);
}

export async function computeDrivingRoute(
  origin: GeoCoordinate,
  destination: GeoCoordinate,
  client: Partial<GoogleClient> = {},
): Promise<DrivingRoute | "no-route" | "failed"> {
  const resolved = resolveClient(client);
  if (resolved === "failed") {
    return "failed";
  }

  try {
    const response = await resolved.fetch(routesUrl, {
      method: "POST",
      headers: {
        ...googleHeaders(resolved.apiKey),
        "X-Goog-FieldMask": routeFieldMask,
      },
      body: JSON.stringify({
        origin: latLngLocation(origin),
        destination: latLngLocation(destination),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        computeAlternativeRoutes: false,
      }),
    });
    if (!response.ok) {
      return "failed";
    }
    return mapGoogleRoute(await response.json());
  } catch {
    return "failed";
  }
}

/** Traffic-aware drive time for a departure, including intermediate stops. Geometry is not requested. */
export async function computeDriveDuration(
  origin: GeoCoordinate,
  destination: GeoCoordinate,
  intermediates: GeoCoordinate[],
  departureTime: Date,
  client: Partial<GoogleClient> = {},
): Promise<number | "no-route" | "failed"> {
  const resolved = resolveClient(client);
  if (resolved === "failed") {
    return "failed";
  }

  try {
    const response = await resolved.fetch(routesUrl, {
      method: "POST",
      headers: {
        ...googleHeaders(resolved.apiKey),
        "X-Goog-FieldMask": durationFieldMask,
      },
      body: JSON.stringify({
        origin: latLngLocation(origin),
        destination: latLngLocation(destination),
        intermediates: intermediates.map((stop) => latLngLocation(stop)),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        departureTime: departureTime.toISOString(),
        computeAlternativeRoutes: false,
      }),
    });
    if (!response.ok) {
      return "failed";
    }
    return readRouteDuration(await response.json());
  } catch {
    return "failed";
  }
}

/** Reverse-geocodes a coordinate into a formatted address. */
export async function lookupAddress(
  position: GeoCoordinate,
  client: Partial<GoogleClient> = {},
): Promise<string | null> {
  const resolved = resolveClient(client);
  if (resolved === "failed") {
    return null;
  }

  const url = new URL(geocodeUrl);
  url.searchParams.set("latlng", `${position.latitude},${position.longitude}`);
  url.searchParams.set("key", resolved.apiKey);

  try {
    const response = await resolved.fetch(url.toString(), { method: "GET" });
    if (!response.ok) {
      return null;
    }
    return readFormattedAddress(await response.json());
  } catch {
    return null;
  }
}

export function readFormattedAddress(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.results)) {
    return null;
  }
  for (const result of body.results) {
    if (!isRecord(result) || typeof result.formatted_address !== "string") {
      continue;
    }
    const address = result.formatted_address.trim();
    if (address.length > 0) {
      return address;
    }
  }
  return null;
}

export function readRouteDuration(body: unknown): number | "no-route" {
  const route = firstRoute(body);
  if (!route || (typeof route.duration !== "string" && typeof route.duration !== "number")) {
    return "no-route";
  }
  return parseDurationSeconds(route.duration);
}

export function mapGoogleRoute(body: unknown): DrivingRoute | "no-route" {
  const route = firstRoute(body);
  if (!route) {
    return "no-route";
  }

  const parsedSteps = readSteps(route);
  if (parsedSteps.length === 0) {
    return "no-route";
  }

  const durations = allocate(parseDurationSeconds(route.duration), parsedSteps.map((step) => step.staticSeconds));
  const steps: RouteStep[] = parsedSteps.map((step, index) => ({
    instruction: step.instruction,
    maneuver: step.maneuver,
    distanceMeters: step.distanceMeters,
    durationSeconds: durations[index] ?? 0,
    path: step.path,
  }));

  const encodedPath = readEncodedPath(route.polyline);
  const path = encodedPath.length > 0 ? encodedPath : steps.flatMap((step) => step.path);
  if (path.length === 0) {
    return "no-route";
  }

  const distanceMeters = readMeters(route.distanceMeters) || steps.reduce((sum, step) => sum + step.distanceMeters, 0);

  return {
    distanceMeters,
    durationSeconds: durations.reduce((sum, duration) => sum + duration, 0),
    path,
    steps,
  };
}

export function mapManeuver(googleManeuver: string): Maneuver {
  switch (googleManeuver) {
    case "DEPART":
      return "depart";
    case "TURN_LEFT":
      return "turn-left";
    case "TURN_RIGHT":
      return "turn-right";
    case "TURN_SLIGHT_LEFT":
      return "slight-left";
    case "TURN_SLIGHT_RIGHT":
      return "slight-right";
    case "TURN_SHARP_LEFT":
      return "sharp-left";
    case "TURN_SHARP_RIGHT":
      return "sharp-right";
    case "UTURN_LEFT":
    case "UTURN_RIGHT":
      return "u-turn";
    case "ROUNDABOUT_LEFT":
    case "ROUNDABOUT_RIGHT":
      return "roundabout";
    case "MERGE":
      return "merge";
    case "FORK_LEFT":
      return "fork-left";
    case "FORK_RIGHT":
      return "fork-right";
    case "RAMP_LEFT":
      return "ramp-left";
    case "RAMP_RIGHT":
      return "ramp-right";
    default:
      return "straight";
  }
}

function resolveClient(client: Partial<GoogleClient>): GoogleClient | "failed" {
  const apiKey = client.apiKey ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (apiKey.length === 0) {
    return "failed";
  }
  return { apiKey, fetch: client.fetch ?? fetch };
}

function googleHeaders(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "X-Goog-Api-Key": apiKey,
  };
}

function autocompleteBody(input: string, bias: GeoCoordinate | null, sessionToken: string): Record<string, unknown> {
  const body: Record<string, unknown> = { input, sessionToken };
  if (bias) {
    body.locationBias = {
      circle: {
        center: { latitude: bias.latitude, longitude: bias.longitude },
        radius: biasRadiusMeters,
      },
    };
  }
  return body;
}

function latLngLocation(coordinate: GeoCoordinate): Record<string, unknown> {
  return {
    location: {
      latLng: { latitude: coordinate.latitude, longitude: coordinate.longitude },
    },
  };
}

type ReadPrediction = {
  placeId: string;
  label: string;
  name: string;
  detail: string;
};

async function locatePrediction(
  client: GoogleClient,
  prediction: ReadPrediction,
  sessionToken: string,
): Promise<PlaceSuggestion | null> {
  try {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(prediction.placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
    const response = await client.fetch(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": client.apiKey,
        "X-Goog-FieldMask": "location",
      },
    });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    const coordinate = isRecord(body) ? readLatLng(body.location) : null;
    if (!coordinate) {
      return null;
    }
    return {
      label: prediction.label,
      name: prediction.name,
      detail: prediction.detail,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    };
  } catch {
    return null;
  }
}

function readPredictions(body: unknown): ReadPrediction[] {
  if (!isRecord(body) || !Array.isArray(body.suggestions)) {
    return [];
  }
  const predictions: ReadPrediction[] = [];
  for (const suggestion of body.suggestions) {
    if (!isRecord(suggestion) || !isRecord(suggestion.placePrediction)) {
      continue;
    }
    const prediction = suggestion.placePrediction;
    const placeId = readPlaceId(prediction);
    const text = readFormattableText(prediction.text);
    const structured = isRecord(prediction.structuredFormat) ? prediction.structuredFormat : null;
    const mainText = structured ? readFormattableText(structured.mainText) : "";
    const detail = structured ? readFormattableText(structured.secondaryText) : "";
    const name = mainText.length > 0 ? mainText : text;
    const label = placeLabel(text, name, detail);
    if (placeId.length === 0 || label.length === 0) {
      continue;
    }
    predictions.push({ placeId, label, name, detail });
    if (predictions.length === suggestionLimit) {
      break;
    }
  }
  return predictions;
}

function readFormattableText(value: unknown): string {
  if (!isRecord(value) || typeof value.text !== "string") {
    return "";
  }
  return value.text.trim();
}

function placeLabel(text: string, name: string, detail: string): string {
  if (name.length > 0 && !text.toLowerCase().includes(name.toLowerCase())) {
    return detail.length > 0 ? `${name}, ${detail}` : name;
  }
  return text;
}

function readPlaceId(prediction: Record<string, unknown>): string {
  if (typeof prediction.placeId === "string" && prediction.placeId.length > 0) {
    return prediction.placeId;
  }
  if (typeof prediction.place === "string" && prediction.place.startsWith("places/")) {
    return prediction.place.slice("places/".length);
  }
  return "";
}

type ParsedStep = {
  instruction: string;
  maneuver: Maneuver;
  distanceMeters: number;
  staticSeconds: number;
  path: GeoCoordinate[];
};

function firstRoute(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !Array.isArray(body.routes) || body.routes.length === 0) {
    return null;
  }
  const route = body.routes[0];
  return isRecord(route) ? route : null;
}

function readSteps(route: Record<string, unknown>): ParsedStep[] {
  if (!Array.isArray(route.legs)) {
    return [];
  }
  const steps: ParsedStep[] = [];
  for (const leg of route.legs) {
    if (!isRecord(leg) || !Array.isArray(leg.steps)) {
      continue;
    }
    for (const step of leg.steps) {
      const parsed = readStep(step);
      if (parsed) {
        steps.push(parsed);
      }
    }
  }
  return steps;
}

function readStep(value: unknown): ParsedStep | null {
  if (!isRecord(value)) {
    return null;
  }
  const navigation = isRecord(value.navigationInstruction) ? value.navigationInstruction : null;
  const rawInstruction = navigation && typeof navigation.instructions === "string" ? stripTags(navigation.instructions) : "";
  const googleManeuver = navigation && typeof navigation.maneuver === "string" ? navigation.maneuver : "";
  const maneuver = arrivalInstruction(rawInstruction) ? "arrive" : mapManeuver(googleManeuver);
  const instruction = rawInstruction.length > 0 ? rawInstruction : fallbackInstruction(maneuver);
  const path = readStepPath(value);
  if (path.length === 0) {
    return null;
  }
  return {
    instruction,
    maneuver,
    distanceMeters: readMeters(value.distanceMeters),
    staticSeconds: parseDurationSeconds(value.staticDuration),
    path,
  };
}

function readStepPath(step: Record<string, unknown>): GeoCoordinate[] {
  const decoded = readEncodedPath(step.polyline);
  if (decoded.length > 0) {
    return decoded;
  }
  const start = readWrappedLatLng(step.startLocation);
  const end = readWrappedLatLng(step.endLocation);
  if (start && end) {
    return [start, end];
  }
  return end ? [end] : start ? [start] : [];
}

function readEncodedPath(value: unknown): GeoCoordinate[] {
  if (!isRecord(value) || typeof value.encodedPolyline !== "string" || value.encodedPolyline.length === 0) {
    return [];
  }
  return decodePolyline(value.encodedPolyline);
}

function readWrappedLatLng(value: unknown): GeoCoordinate | null {
  if (!isRecord(value)) {
    return null;
  }
  return readLatLng(isRecord(value.latLng) ? value.latLng : value);
}

function readLatLng(value: unknown): GeoCoordinate | null {
  if (!isRecord(value) || typeof value.latitude !== "number" || typeof value.longitude !== "number") {
    return null;
  }
  if (!Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) {
    return null;
  }
  return { latitude: value.latitude, longitude: value.longitude };
}

function readMeters(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function parseDurationSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value !== "string") {
    return 0;
  }
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  const seconds = match?.[1];
  if (!seconds) {
    return 0;
  }
  return Math.max(0, Math.round(Number(seconds)));
}

function arrivalInstruction(instruction: string): boolean {
  return /^\s*arrive\b/i.test(instruction);
}

function fallbackInstruction(maneuver: Maneuver): string {
  switch (maneuver) {
    case "depart":
      return "Depart";
    case "turn-left":
      return "Turn left";
    case "turn-right":
      return "Turn right";
    case "slight-left":
      return "Slight left";
    case "slight-right":
      return "Slight right";
    case "sharp-left":
      return "Sharp left";
    case "sharp-right":
      return "Sharp right";
    case "u-turn":
      return "Make a U-turn";
    case "roundabout":
      return "Enter the roundabout";
    case "merge":
      return "Merge";
    case "fork-left":
      return "Keep left";
    case "fork-right":
      return "Keep right";
    case "ramp-left":
      return "Take the ramp on the left";
    case "ramp-right":
      return "Take the ramp on the right";
    case "arrive":
      return "You have arrived";
    default:
      return "Continue";
  }
}

function stripTags(instruction: string): string {
  return instruction.replace(/<[^>]*>/g, "").trim();
}

/** Spreads a total across weights. The returned values are non-negative integers that sum to the rounded total. */
function allocate(total: number, weights: number[]): number[] {
  const count = weights.length;
  if (count === 0) {
    return [];
  }
  const whole = Math.max(0, Math.round(total));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) {
    const base = Math.floor(whole / count);
    const result = Array.from({ length: count }, () => base);
    const last = count - 1;
    result[last] = whole - base * last;
    return result;
  }

  const exact = weights.map((weight) => (whole * weight) / weightSum);
  const result = exact.map((value) => Math.floor(value));
  let used = result.reduce((sum, value) => sum + value, 0);
  const remainders = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const item of remainders) {
    if (used >= whole) {
      break;
    }
    const current = result[item.index];
    if (current === undefined) {
      continue;
    }
    result[item.index] = current + 1;
    used += 1;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
