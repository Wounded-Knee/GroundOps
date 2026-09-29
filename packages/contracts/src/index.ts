/** Live fanout subject. The bus carries this envelope; it is not a domain event. */
export const realtimeSubject = "realtime.broadcast";

export type RealtimeEnvelope = {
  id: string;
  type: string;
};

export type User = {
  id: string;
  displayName: string | null;
  email: string | null;
};

export type CreateSessionRequest = {
  googleIdToken: string;
};

export type CreateSessionResponse = {
  token: string;
  user: User;
};

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

export type DrivingRoute = {
  distanceMeters: number;
  durationSeconds: number;
  path: GeoCoordinate[];
  steps: RouteStep[];
};

export type DrivingRouteResponse = {
  route: DrivingRoute;
};

/** Platform sortie type this slice authors. */
export const taskSortieType = "task";

export type Driver = {
  id: string;
  userId: string;
};

export type SortieStop = {
  label: string;
  latitude: number;
  longitude: number;
};

export type Sortie = {
  id: string;
  type: typeof taskSortieType;
  label: string;
  arrivalAt: string;
  scheduledStart: string;
  scheduledEnd: string;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: SortieStop[];
};

export type SortieWriteRequest = {
  label: string;
  arrivalAt: string;
  passengerName: string | null;
  passengerPhone: string | null;
  stops: SortieStop[];
};

export type LocationObservationRequest = {
  observedAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
};

export type CalendarResponse = {
  sorties: Sortie[];
};
