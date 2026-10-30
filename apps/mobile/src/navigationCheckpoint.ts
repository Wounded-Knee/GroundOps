import type {
  DrivingRoute,
  GeoCoordinate,
  Maneuver,
  PlaceSuggestion,
  RouteLeg,
  RouteStep,
  Sortie,
  SortieStop,
  Tariff,
} from "@groundops/contracts";
import { maneuvers, taskSortieType } from "@groundops/contracts";
import type { MeterState } from "./meter";
import type { ArrivalDwellState } from "./sortieDwell";

export const navigationCheckpointVersion = 1;

export type CheckpointCameraMode = "follow" | "overview";

export type SortieGuidingSession = {
  mode: "guiding";
  kind: "sortie";
  destination: PlaceSuggestion;
  route: DrivingRoute;
  stepIndex: number;
  muted: boolean;
  offRouteSince: number | null;
  rerouteMessage: string | null;
  sortieId: string;
  stops: SortieStop[];
  firstStopPosition: number;
  tariff: Tariff | null;
  sortie: Sortie;
};

export type SortieArrivedSession = {
  mode: "arrived";
  kind: "sortie";
  destination: PlaceSuggestion;
  route: DrivingRoute;
  muted: boolean;
  tariff: Tariff | null;
  meter: MeterState;
  stops: SortieStop[];
  sortieId: string;
  sortie: Sortie;
  stopPosition: number;
  waitEndsAt: number;
  meterPaused: boolean;
  pendingNextLeg: boolean;
};

export type SortieNavigationSession = SortieGuidingSession | SortieArrivedSession;

/** Device copy of an in-progress sortie guidance session. The server does not store this. */
export type NavigationCheckpoint = {
  version: typeof navigationCheckpointVersion;
  userId: string;
  savedAt: number;
  nav: SortieNavigationSession;
  meter: MeterState;
  baselineRemainingMeters: number;
  cameraMode: CheckpointCameraMode;
  dwell: ArrivalDwellState;
  spokenKey: string | null;
  completedLegPaths: GeoCoordinate[][];
  routeEpoch: number;
};

export type ActivitySortieSnapshot = {
  asOf: string;
  sortie: Sortie | null;
};

/**
 * Drop the last GPS sample so the time the process was dead is not accrued as wait.
 * Motion starts unknown until the next fix.
 */
export function meterForCheckpoint(meter: MeterState): MeterState {
  if (meter.last === null && meter.motion === "unknown") {
    return meter;
  }
  return { ...meter, last: null, motion: "unknown" };
}

export function assembleCheckpoint(input: {
  userId: string;
  savedAt: number;
  nav: SortieNavigationSession;
  meter: MeterState;
  baselineRemainingMeters: number;
  cameraMode: CheckpointCameraMode;
  dwell: ArrivalDwellState;
  spokenKey: string | null;
  completedLegPaths: GeoCoordinate[][];
  routeEpoch: number;
}): NavigationCheckpoint {
  const meter = meterForCheckpoint(input.meter);
  const nav = input.nav.mode === "arrived" ? { ...input.nav, meter } : input.nav;
  return {
    version: navigationCheckpointVersion,
    userId: input.userId,
    savedAt: input.savedAt,
    nav,
    meter,
    baselineRemainingMeters: input.baselineRemainingMeters,
    cameraMode: input.cameraMode,
    dwell: input.dwell,
    spokenKey: input.spokenKey,
    completedLegPaths: input.completedLegPaths,
    routeEpoch: input.routeEpoch,
  };
}

/** Reject an unknown document, a different user, or anything that is not an active sortie session. */
export function parseNavigationCheckpoint(value: unknown, userId: string): NavigationCheckpoint | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== navigationCheckpointVersion || record.userId !== userId) {
    return null;
  }
  if (typeof record.savedAt !== "number" || !Number.isFinite(record.savedAt)) {
    return null;
  }
  const nav = parseSession(record.nav);
  const meter = parseMeter(record.meter);
  const dwell = parseDwell(record.dwell);
  const cameraMode = parseCameraMode(record.cameraMode);
  const completedLegPaths = parsePaths(record.completedLegPaths);
  const routeEpoch = wholeNumber(record.routeEpoch);
  if (
    !nav ||
    !meter ||
    !dwell ||
    !cameraMode ||
    !completedLegPaths ||
    routeEpoch === null ||
    routeEpoch < 0 ||
    typeof record.baselineRemainingMeters !== "number" ||
    !Number.isFinite(record.baselineRemainingMeters) ||
    !isSpokenKey(record.spokenKey)
  ) {
    return null;
  }
  const resumedMeter = meterForCheckpoint(meter);
  const resumedNav = nav.mode === "arrived" ? { ...nav, meter: resumedMeter } : nav;
  return {
    version: navigationCheckpointVersion,
    userId,
    savedAt: record.savedAt,
    nav: resumedNav,
    meter: resumedMeter,
    baselineRemainingMeters: record.baselineRemainingMeters,
    cameraMode,
    dwell,
    spokenKey: record.spokenKey,
    completedLegPaths,
    routeEpoch,
  };
}

/**
 * After a restore, the first activity snapshot decides whether that session is still open.
 * An empty `asOf` means the snapshot has not arrived. A sortie started in this process is not checked.
 */
export function shouldAbandonRestoredSortie(input: {
  restored: boolean;
  nav: { mode: string; kind?: string; sortieId?: string | null };
  activity: ActivitySortieSnapshot;
}): boolean {
  if (!input.restored || input.activity.asOf === "") {
    return false;
  }
  const { nav } = input;
  if ((nav.mode !== "guiding" && nav.mode !== "arrived") || nav.kind !== "sortie" || !nav.sortieId) {
    return false;
  }
  const sortie = input.activity.sortie;
  return !(
    sortie !== null &&
    sortie.id === nav.sortieId &&
    sortie.actualStart !== null &&
    sortie.actualEnd === null
  );
}

/**
 * A restored dwell that is not yet satisfied must not be settled from the quiet-GPS timer
 * until a new fix confirms the vehicle is still there.
 */
export function shouldSettleRestoredDwell(input: {
  satisfied: boolean;
  seenFixSinceRestore: boolean;
}): boolean {
  if (input.satisfied) {
    return true;
  }
  return input.seenFixSinceRestore;
}

function parseSession(value: unknown): SortieNavigationSession | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== "sortie" || (record.mode !== "guiding" && record.mode !== "arrived")) {
    return null;
  }
  const destination = parsePlace(record.destination);
  const route = parseRoute(record.route);
  const stops = parseStops(record.stops);
  const sortie = parseSortie(record.sortie);
  const tariff = parseTariff(record.tariff);
  if (
    !destination ||
    !route ||
    !stops ||
    !sortie ||
    tariff === undefined ||
    record.sortieId !== sortie.id ||
    typeof record.muted !== "boolean"
  ) {
    return null;
  }
  if (record.mode === "guiding") {
    const stepIndex = wholeNumber(record.stepIndex);
    const firstStopPosition = wholeNumber(record.firstStopPosition);
    if (
      stepIndex === null ||
      stepIndex < 0 ||
      (route.steps.length > 0 && stepIndex >= route.steps.length) ||
      firstStopPosition === null ||
      firstStopPosition < 0 ||
      firstStopPosition >= stops.length ||
      !isNullableNumber(record.offRouteSince) ||
      !isNullableString(record.rerouteMessage)
    ) {
      return null;
    }
    return {
      mode: "guiding",
      kind: "sortie",
      destination,
      route,
      stepIndex,
      muted: record.muted,
      offRouteSince: record.offRouteSince,
      rerouteMessage: record.rerouteMessage,
      sortieId: sortie.id,
      stops,
      firstStopPosition,
      tariff,
      sortie,
    };
  }
  const meter = parseMeter(record.meter);
  const stopPosition = wholeNumber(record.stopPosition);
  if (
    !meter ||
    stopPosition === null ||
    stopPosition < 0 ||
    stopPosition >= stops.length ||
    typeof record.waitEndsAt !== "number" ||
    !Number.isFinite(record.waitEndsAt) ||
    typeof record.meterPaused !== "boolean" ||
    typeof record.pendingNextLeg !== "boolean"
  ) {
    return null;
  }
  return {
    mode: "arrived",
    kind: "sortie",
    destination,
    route,
    muted: record.muted,
    tariff,
    meter,
    stops,
    sortieId: sortie.id,
    sortie,
    stopPosition,
    waitEndsAt: record.waitEndsAt,
    meterPaused: record.meterPaused,
    pendingNextLeg: record.pendingNextLeg,
  };
}

function parseMeter(value: unknown): MeterState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.milesTraveled !== "number" ||
    !Number.isFinite(record.milesTraveled) ||
    record.milesTraveled < 0 ||
    typeof record.waitSeconds !== "number" ||
    !Number.isFinite(record.waitSeconds) ||
    record.waitSeconds < 0 ||
    !isNullableNumber(record.alongMeters) ||
    (record.motion !== "unknown" && record.motion !== "stationary" && record.motion !== "moving") ||
    typeof record.flagDropped !== "boolean"
  ) {
    return null;
  }
  return {
    milesTraveled: record.milesTraveled,
    waitSeconds: record.waitSeconds,
    last: null,
    alongMeters: record.alongMeters,
    motion: record.motion,
    flagDropped: record.flagDropped,
  };
}

function parseDwell(value: unknown): ArrivalDwellState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const anchor = record.anchor === null ? null : parseCoordinate(record.anchor);
  if (
    (record.anchor !== null && !anchor) ||
    !isNullableNumber(record.startedAtMs) ||
    typeof record.satisfied !== "boolean"
  ) {
    return null;
  }
  return { anchor, startedAtMs: record.startedAtMs, satisfied: record.satisfied };
}

function parseCameraMode(value: unknown): CheckpointCameraMode | null {
  if (value === "follow" || value === "overview") {
    return value;
  }
  return null;
}

function parsePlace(value: unknown): PlaceSuggestion | null {
  const coordinate = parseCoordinate(value);
  if (!coordinate || typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.label !== "string" || typeof record.name !== "string" || typeof record.detail !== "string") {
    return null;
  }
  return { ...coordinate, label: record.label, name: record.name, detail: record.detail };
}

function parseRoute(value: unknown): DrivingRoute | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const path = parseCoordinates(record.path);
  const steps = parseSteps(record.steps);
  const legs = parseLegs(record.legs);
  if (
    !path ||
    !steps ||
    !legs ||
    typeof record.distanceMeters !== "number" ||
    !Number.isFinite(record.distanceMeters) ||
    typeof record.durationSeconds !== "number" ||
    !Number.isFinite(record.durationSeconds)
  ) {
    return null;
  }
  return { distanceMeters: record.distanceMeters, durationSeconds: record.durationSeconds, path, steps, legs };
}

function parseSteps(value: unknown): RouteStep[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const steps: RouteStep[] = [];
  for (const item of value) {
    const step = parseStep(item);
    if (!step) {
      return null;
    }
    steps.push(step);
  }
  return steps;
}

function parseStep(value: unknown): RouteStep | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const path = parseCoordinates(record.path);
  if (
    !path ||
    typeof record.instruction !== "string" ||
    !isManeuver(record.maneuver) ||
    typeof record.distanceMeters !== "number" ||
    !Number.isFinite(record.distanceMeters) ||
    typeof record.durationSeconds !== "number" ||
    !Number.isFinite(record.durationSeconds)
  ) {
    return null;
  }
  return {
    instruction: record.instruction,
    maneuver: record.maneuver,
    distanceMeters: record.distanceMeters,
    durationSeconds: record.durationSeconds,
    path,
  };
}

function parseLegs(value: unknown): RouteLeg[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const legs: RouteLeg[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record = item as Record<string, unknown>;
    const path = parseCoordinates(record.path);
    const steps = parseSteps(record.steps);
    if (
      !path ||
      !steps ||
      typeof record.distanceMeters !== "number" ||
      !Number.isFinite(record.distanceMeters) ||
      typeof record.durationSeconds !== "number" ||
      !Number.isFinite(record.durationSeconds)
    ) {
      return null;
    }
    legs.push({
      distanceMeters: record.distanceMeters,
      durationSeconds: record.durationSeconds,
      path,
      steps,
    });
  }
  return legs;
}

function parseStops(value: unknown): SortieStop[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const stops: SortieStop[] = [];
  for (const item of value) {
    const stop = parseStop(item);
    if (!stop) {
      return null;
    }
    stops.push(stop);
  }
  return stops;
}

function parseStop(value: unknown): SortieStop | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const waitMinutes = wholeNumber(record.waitMinutes);
  if (
    typeof record.label !== "string" ||
    record.label.length === 0 ||
    typeof record.latitude !== "number" ||
    !Number.isFinite(record.latitude) ||
    typeof record.longitude !== "number" ||
    !Number.isFinite(record.longitude) ||
    waitMinutes === null ||
    waitMinutes < 0 ||
    typeof record.passenger !== "boolean" ||
    !isNullableString(record.actualArrivedAt) ||
    !isNullableString(record.actualDepartedAt)
  ) {
    return null;
  }
  return {
    label: record.label,
    latitude: record.latitude,
    longitude: record.longitude,
    waitMinutes,
    passenger: record.passenger,
    actualArrivedAt: record.actualArrivedAt,
    actualDepartedAt: record.actualDepartedAt,
  };
}

function parseSortie(value: unknown): Sortie | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const stops = parseStops(record.stops);
  if (
    !stops ||
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    record.type !== taskSortieType ||
    typeof record.label !== "string" ||
    typeof record.arrivalAt !== "string" ||
    typeof record.arrivalAuthored !== "boolean" ||
    typeof record.scheduledStart !== "string" ||
    typeof record.scheduledEnd !== "string" ||
    !isNullableString(record.actualStart) ||
    !isNullableString(record.actualEnd) ||
    typeof record.departureAddress !== "string" ||
    !isNullableString(record.passengerName) ||
    !isNullableString(record.passengerPhone)
  ) {
    return null;
  }
  return {
    id: record.id,
    type: taskSortieType,
    label: record.label,
    arrivalAt: record.arrivalAt,
    arrivalAuthored: record.arrivalAuthored,
    scheduledStart: record.scheduledStart,
    scheduledEnd: record.scheduledEnd,
    actualStart: record.actualStart,
    actualEnd: record.actualEnd,
    departureAddress: record.departureAddress,
    passengerName: record.passengerName,
    passengerPhone: record.passengerPhone,
    stops,
  };
}

function parseTariff(value: unknown): Tariff | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isCents(record.flagCents) || !isCents(record.perMileCents) || !isCents(record.perWaitMinuteCents)) {
    return undefined;
  }
  return {
    flagCents: record.flagCents,
    perMileCents: record.perMileCents,
    perWaitMinuteCents: record.perWaitMinuteCents,
  };
}

function parsePaths(value: unknown): GeoCoordinate[][] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const paths: GeoCoordinate[][] = [];
  for (const item of value) {
    const path = parseCoordinates(item);
    if (!path) {
      return null;
    }
    paths.push(path);
  }
  return paths;
}

function parseCoordinates(value: unknown): GeoCoordinate[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const coordinates: GeoCoordinate[] = [];
  for (const item of value) {
    const coordinate = parseCoordinate(item);
    if (!coordinate) {
      return null;
    }
    coordinates.push(coordinate);
  }
  return coordinates;
}

function parseCoordinate(value: unknown): GeoCoordinate | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.latitude !== "number" ||
    !Number.isFinite(record.latitude) ||
    typeof record.longitude !== "number" ||
    !Number.isFinite(record.longitude)
  ) {
    return null;
  }
  return { latitude: record.latitude, longitude: record.longitude };
}

function isManeuver(value: unknown): value is Maneuver {
  return typeof value === "string" && (maneuvers as readonly string[]).includes(value);
}

function wholeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  return value;
}

function isCents(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSpokenKey(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
