import type { DrivingRoute, GeoCoordinate, Maneuver, RouteStep } from "@groundops/contracts";
import { decodePolyline } from "./polyline.js";

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
    case "NAME_CHANGE":
      return "name-change";
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
    case "name-change":
      return "Continue";
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
