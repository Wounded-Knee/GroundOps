import type { DrivingRoute, GeoCoordinate, Maneuver, RouteStep } from "@groundops/contracts";

export const stepAdvanceMeters = 30;
export const offRouteMeters = 50;
export const offRouteMilliseconds = 5_000;
export const arrivalMeters = 40;
export const guidanceTilt = 50;
export const guidanceZoom = 17.5;

export type FixResult = {
  arrived: boolean;
  stepIndex: number;
  offRouteSince: number | null;
  shouldReroute: boolean;
};

export function applyLocationFix(input: {
  fix: GeoCoordinate;
  destination: GeoCoordinate;
  route: DrivingRoute;
  stepIndex: number;
  now: number;
  offRouteSince: number | null;
  rerouteInFlight: boolean;
}): FixResult {
  if (distanceMeters(input.fix, input.destination) <= arrivalMeters) {
    return {
      arrived: true,
      stepIndex: input.stepIndex,
      offRouteSince: null,
      shouldReroute: false,
    };
  }

  const lastIndex = Math.max(0, input.route.steps.length - 1);
  let stepIndex = Math.min(Math.max(0, input.stepIndex), lastIndex);
  const step = input.route.steps[stepIndex];
  if (step && stepIndex < lastIndex && distanceToStepEnd(input.fix, step) <= stepAdvanceMeters) {
    stepIndex += 1;
  }

  const offRoute = distanceToPathMeters(input.fix, input.route.path) > offRouteMeters;
  if (!offRoute) {
    return { arrived: false, stepIndex, offRouteSince: null, shouldReroute: false };
  }

  const offRouteSince = input.offRouteSince ?? input.now;
  const sustained = input.now - offRouteSince >= offRouteMilliseconds;
  return {
    arrived: false,
    stepIndex,
    offRouteSince,
    shouldReroute: sustained && !input.rerouteInFlight,
  };
}

export function remainingDistanceMeters(fix: GeoCoordinate, route: DrivingRoute, stepIndex: number): number {
  const step = route.steps[stepIndex];
  if (!step) {
    return 0;
  }
  const later = route.steps.slice(stepIndex + 1).reduce((sum, item) => sum + item.distanceMeters, 0);
  return distanceToStepEnd(fix, step) + later;
}

export function remainingDurationSeconds(fix: GeoCoordinate, route: DrivingRoute, stepIndex: number): number {
  const step = route.steps[stepIndex];
  if (!step) {
    return 0;
  }
  const later = route.steps.slice(stepIndex + 1).reduce((sum, item) => sum + item.durationSeconds, 0);
  return step.durationSeconds * remainingFraction(fix, step) + later;
}

export function distanceToStepEnd(fix: GeoCoordinate, step: RouteStep): number {
  const end = step.path[step.path.length - 1];
  if (!end) {
    return step.distanceMeters;
  }
  return distanceMeters(fix, end);
}

export function distanceMeters(from: GeoCoordinate, to: GeoCoordinate): number {
  const earthRadius = 6_371_000;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const fromLat = radians(from.latitude);
  const toLat = radians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function distanceToPathMeters(point: GeoCoordinate, path: GeoCoordinate[]): number {
  const first = path[0];
  if (!first) {
    return Number.POSITIVE_INFINITY;
  }
  if (path.length === 1) {
    return distanceMeters(point, first);
  }
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    if (!start || !end) {
      continue;
    }
    nearest = Math.min(nearest, distanceToSegmentMeters(point, start, end));
  }
  return nearest;
}

export function overviewCamera(path: GeoCoordinate[]): { latitude: number; longitude: number; zoom: number } | null {
  const first = path[0];
  if (!first) {
    return null;
  }
  let minLatitude = first.latitude;
  let maxLatitude = first.latitude;
  let minLongitude = first.longitude;
  let maxLongitude = first.longitude;
  for (const point of path) {
    minLatitude = Math.min(minLatitude, point.latitude);
    maxLatitude = Math.max(maxLatitude, point.latitude);
    minLongitude = Math.min(minLongitude, point.longitude);
    maxLongitude = Math.max(maxLongitude, point.longitude);
  }
  const span = Math.max(maxLatitude - minLatitude, maxLongitude - minLongitude, 0.0005);
  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    zoom: Math.min(17, Math.max(3, Math.log2(360 / span) - 1)),
  };
}

export function travelBearing(course: number | null, compass: number | null): number | null {
  if (course !== null && course >= 0) {
    return course;
  }
  if (compass !== null && compass >= 0) {
    return compass;
  }
  return null;
}

export function formatMeters(meters: number): string {
  const rounded = Math.max(0, Math.round(meters));
  if (rounded < 1000) {
    return `${rounded} m`;
  }
  return `${(rounded / 1000).toFixed(1)} km`;
}

export function formatSeconds(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function maneuverLabel(maneuver: Maneuver): string {
  switch (maneuver) {
    case "depart":
      return "Depart";
    case "straight":
      return "Continue";
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
      return "U-turn";
    case "roundabout":
      return "Roundabout";
    case "merge":
      return "Merge";
    case "fork-left":
      return "Keep left";
    case "fork-right":
      return "Keep right";
    case "ramp-left":
      return "Ramp left";
    case "ramp-right":
      return "Ramp right";
    case "arrive":
      return "Arrive";
  }
}

function remainingFraction(fix: GeoCoordinate, step: RouteStep): number {
  if (step.distanceMeters <= 0) {
    return distanceToStepEnd(fix, step) <= stepAdvanceMeters ? 0 : 1;
  }
  return Math.min(1, Math.max(0, distanceToStepEnd(fix, step) / step.distanceMeters));
}

function distanceToSegmentMeters(point: GeoCoordinate, start: GeoCoordinate, end: GeoCoordinate): number {
  const origin = toMeters(start, point);
  const segment = toMeters(start, end);
  const lengthSquared = segment.x * segment.x + segment.y * segment.y;
  if (lengthSquared === 0) {
    return Math.hypot(origin.x, origin.y);
  }
  const progress = Math.min(1, Math.max(0, (origin.x * segment.x + origin.y * segment.y) / lengthSquared));
  return Math.hypot(origin.x - segment.x * progress, origin.y - segment.y * progress);
}

function toMeters(origin: GeoCoordinate, point: GeoCoordinate): { x: number; y: number } {
  const latitude = radians(origin.latitude);
  return {
    x: (point.longitude - origin.longitude) * 111_320 * Math.cos(latitude),
    y: (point.latitude - origin.latitude) * 111_320,
  };
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
