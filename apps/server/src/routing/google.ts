import type { DrivingRoute, GeoCoordinate, PlaceSuggestion } from "@groundops/contracts";
import { mapGoogleRoute, readFormattedAddress, readRouteDuration } from "./googleRoute.js";

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
  "routes.legs.distanceMeters",
  "routes.legs.polyline.encodedPolyline",
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
  client?: Partial<GoogleClient>,
): Promise<DrivingRoute | "no-route" | "failed">;
export async function computeDrivingRoute(
  origin: GeoCoordinate,
  destination: GeoCoordinate,
  intermediates: GeoCoordinate[],
  client?: Partial<GoogleClient>,
): Promise<DrivingRoute | "no-route" | "failed">;
export async function computeDrivingRoute(
  origin: GeoCoordinate,
  destination: GeoCoordinate,
  third: GeoCoordinate[] | Partial<GoogleClient> = [],
  fourth: Partial<GoogleClient> = {},
): Promise<DrivingRoute | "no-route" | "failed"> {
  const intermediates = Array.isArray(third) ? third : [];
  const client = Array.isArray(third) ? fourth : third;
  const resolved = resolveClient(client);
  if (resolved === "failed") {
    return "failed";
  }

  try {
    const body: Record<string, unknown> = {
      origin: latLngLocation(origin),
      destination: latLngLocation(destination),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: false,
    };
    if (intermediates.length > 0) {
      body.intermediates = intermediates.map((stop) => latLngLocation(stop));
    }
    const response = await resolved.fetch(routesUrl, {
      method: "POST",
      headers: {
        ...googleHeaders(resolved.apiKey),
        "X-Goog-FieldMask": routeFieldMask,
      },
      body: JSON.stringify(body),
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


function readLatLng(value: unknown): { latitude: number; longitude: number } | null {
  if (!isRecord(value) || typeof value.latitude !== "number" || typeof value.longitude !== "number") {
    return null;
  }
  if (!Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) {
    return null;
  }
  return { latitude: value.latitude, longitude: value.longitude };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
