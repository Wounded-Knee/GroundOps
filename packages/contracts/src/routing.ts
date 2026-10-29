export const maneuvers = [
  "depart",
  "straight",
  "turn-left",
  "turn-right",
  "slight-left",
  "slight-right",
  "sharp-left",
  "sharp-right",
  "u-turn",
  "roundabout",
  "merge",
  "name-change",
  "fork-left",
  "fork-right",
  "ramp-left",
  "ramp-right",
  "arrive",
] as const;

export type Maneuver = (typeof maneuvers)[number];

export type GeoCoordinate = {
  latitude: number;
  longitude: number;
};

export type PlaceSuggestionsRequest = {
  query: string;
  bias?: GeoCoordinate | null;
};

export type PlaceSuggestion = GeoCoordinate & {
  label: string;
  name: string;
  detail: string;
};

export type PlaceSuggestionsResponse = {
  suggestions: PlaceSuggestion[];
};

export type DrivingRouteRequest = {
  origin: GeoCoordinate;
  destination: GeoCoordinate;
};

export type RouteStep = {
  instruction: string;
  maneuver: Maneuver;
  distanceMeters: number;
  durationSeconds: number;
  path: GeoCoordinate[];
};

/** One waypoint-to-waypoint portion of a driving route. */
export type RouteLeg = {
  distanceMeters: number;
  durationSeconds: number;
  path: GeoCoordinate[];
  steps: RouteStep[];
};

export type DrivingRoute = {
  distanceMeters: number;
  durationSeconds: number;
  path: GeoCoordinate[];
  steps: RouteStep[];
  legs: RouteLeg[];
};

export type DrivingRouteResponse = {
  route: DrivingRoute;
};
