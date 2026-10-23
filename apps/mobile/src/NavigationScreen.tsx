import type {
  DrivingRoute,
  GeoCoordinate,
  PlaceSuggestion,
  ReplaceMeterReadingRequest,
  Sortie,
  SortieStop,
  SortieWriteRequest,
  Tariff,
  User,
} from "@groundops/contracts";
import { Ionicons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AddressPicker } from "./AddressPicker";
import { NetworkStatusIcon } from "./NetworkStatusIcon";
import type { NetworkFault } from "./networkStatus";
import { meterPanelHeight } from "./MeterStrip";
import { useTheme } from "./ThemeProvider";
import { withAlpha, type ThemeColors } from "./theme";
import { resolveApiUrl } from "./apiUrl";
import {
  assertStopArrival,
  authorSortie,
  commenceSortie,
  previewSortie,
  reviseSortie,
  scheduleConflictMessage,
  clearMeterReading,
  completeSortie,
  ensureCurrentDriver,
  extendStopWait,
  replaceMeterReading,
  reportLocationObservation,
  requestCalendar,
  requestTariff,
} from "./calendarClient";
import { setActiveSortieObservation } from "./locationObservationReporting";
import { cancelDepartureAlerts, scheduleDepartureAlerts } from "./departureAlerts";
import {
  ensureCountdownLeadMinutesLoaded,
  getCountdownLeadMinutes,
  subscribeCountdownLeadMinutes,
} from "./countdownPrefs";
import { formatCountdown, nextDeparture, showDepartureCountdown, type NextDeparture } from "./nextDeparture";
import {
  applyLocationFix,
  arrivalMeters,
  bearingDeltaDegrees,
  distanceMeters,
  distanceToStepEnd,
  distanceToUpcomingManeuver,
  formatMeters,
  formatSeconds,
  guidanceLookAheadMeters,
  maneuverLabel,
  requiresCourseAdjustment,
  turnSide,
  offsetAlongBearing,
  overviewCamera,
  routeOverviewCamera,
  noteRouteBearing,
  noteRouteFix,
  pathLengthMeters,
  poseAt,
  projectOntoPath,
  remainingDistanceMeters,
  shouldAnnounceUpcoming,
  upcomingStep,
  type MotionPose,
  type RouteMotion,
  upcomingStepIndex,
} from "./guidance";
import {
  ensureGuidanceCameraPrefsLoaded,
  getGuidanceCameraPrefs,
  subscribeGuidanceCameraPrefs,
} from "./guidanceCameraPrefs";
import {
  ensureGuidanceMutePrefsLoaded,
  getGuidanceMutePrefs,
  saveGuidanceMutePrefs,
} from "./guidanceMutePrefs";
import {
  ensureGuidanceTimingPrefsLoaded,
  getGuidanceTimingPrefs,
  subscribeGuidanceTimingPrefs,
} from "./guidanceTimingPrefs";
import {
  advanceMeterAlongRoute,
  baselineAfterReroute,
  emptyMeter,
  formatTripEstimate,
  meterCharges,
  noteFlagDrop,
  resetMeterRouteProgress,
  stationaryDisplacementMeters,
  tickMeterWait,
  type MeterState,
} from "./meter";
import type { AccountActivity } from "./liveActivity";
import { completedSortie, overviewPathForUpload, reportDelayMs, stopListKey } from "./liveActivity";
import type { MeterDisplay } from "./MeterStrip";
import { PlatformMap, type MapCamera, type MapCameraMove, type MapHandle } from "./PlatformMap";
import { requestDrivingRoute, requestSortieDrivingRoute } from "./routingClient";
import {
  bumpStopWaitMinutes,
  emptyArrivalDwell,
  extendWaitEndsAt,
  hasLaterStop,
  isFinalStop,
  noteArrivalDwell,
  settleArrivalDwell,
  shouldCompleteOnLeave,
  waitEndsAtFromStop,
} from "./sortieDwell";
import type { SortieGuideCommand } from "./sortieGuide";
import type { PlaceGuideCommand } from "./placeGuide";
import type { DeadheadCommand } from "./deadheadShortcutLogic";
import { shortcutMayStart, shortcutNavKind } from "./deadheadShortcutLogic";
import { throb } from "./VisualAlert";
import { floatingRouteScale, isActiveNavigation } from "./alwaysOnTopLogic";

export type { SortieGuideCommand } from "./sortieGuide";

type PreviewNav = {
  mode: "preview";
  destination: PlaceSuggestion;
  route: DrivingRoute;
  sortieId: string | null;
  stops: SortieStop[];
  tariff: Tariff | null;
  sortie: Sortie | null;
  /** Last passenger flag the server accepted. Null until that write succeeds. */
  passenger: boolean | null;
  /** Choice in flight. Start stays disabled while this is set. */
  pendingPassenger: boolean | null;
  message: string | null;
};

type NavState =
  | { mode: "browse"; message: string | null; destination: PlaceSuggestion | null }
  | PreviewNav
  | {
      mode: "guiding";
      kind: "search" | "sortie";
      destination: PlaceSuggestion;
      route: DrivingRoute;
      stepIndex: number;
      muted: boolean;
      offRouteSince: number | null;
      rerouteMessage: string | null;
      sortieId: string | null;
      stops: SortieStop[];
      firstStopPosition: number;
      tariff: Tariff | null;
      sortie: Sortie | null;
    }
  | {
      mode: "arrived";
      kind: "search" | "sortie";
      destination: PlaceSuggestion;
      route: DrivingRoute;
      muted: boolean;
      tariff: Tariff | null;
      meter: MeterState;
      stops: SortieStop[];
      sortieId: string | null;
      sortie: Sortie | null;
      stopPosition: number;
      waitEndsAt: number;
      meterPaused: boolean;
      pendingNextLeg: boolean;
    };

const apiUrl = resolveApiUrl();
const poseEpsilonMeters = 0.25;
const poseEpsilonDegrees = 0.2;
/** Ignore compass bearing changes smaller than this. The control hides within this span of north. */
const compassBearingEpsilonDegrees = 1;

type GuidanceCameraMode = "follow" | "overview";

function displayedPoseMoved(previous: MotionPose | null, next: MotionPose): boolean {
  if (!previous) {
    return true;
  }
  if (Math.abs(bearingDeltaDegrees(previous.bearing, next.bearing)) >= poseEpsilonDegrees) {
    return true;
  }
  return distanceMeters(previous, next) >= poseEpsilonMeters;
}

export function NavigationScreen({
  token,
  onUnauthorized,
  sortieGuide = null,
  onSortieGuideConsumed,
  placeGuide = null,
  onPlaceGuideConsumed,
  deadhead = null,
  onDeadheadConsumed,
  onMeterReading,
  onMeterEnded,
  onSortieCompleted,
  onOnwardDestination,
  endGuidanceRef,
  meterArriveRef,
  meterPlusOneRef,
  meterOnwardRef,
  meterCommenceRef,
  applySortieUpdateRef,
  accountView = null,
  networkFault,
  minimal = false,
  onActiveNavigationChange,
}: {
  token: string;
  onUnauthorized: () => void;
  sortieGuide?: SortieGuideCommand | null;
  onSortieGuideConsumed?: () => void;
  placeGuide?: PlaceGuideCommand | null;
  onPlaceGuideConsumed?: () => void;
  deadhead?: DeadheadCommand | null;
  onDeadheadConsumed?: () => void;
  onMeterReading?: (reading: MeterDisplay | null) => void;
  onMeterEnded?: () => void;
  onSortieCompleted?: (sortie: Sortie) => void;
  onOnwardDestination?: (sortie: Sortie) => void;
  endGuidanceRef?: MutableRefObject<(() => void) | null>;
  meterArriveRef?: MutableRefObject<(() => void) | null>;
  meterPlusOneRef?: MutableRefObject<(() => void) | null>;
  meterOnwardRef?: MutableRefObject<(() => void) | null>;
  meterCommenceRef?: MutableRefObject<(() => void) | null>;
  applySortieUpdateRef?: MutableRefObject<((sortie: Sortie) => void) | null>;
  networkFault: NetworkFault | null;
  /** Map only, while the Android picture-in-picture window is up. */
  minimal?: boolean;
  onActiveNavigationChange?: (active: boolean) => void;
  accountView?: {
    user: User;
    live: "authenticated" | "closed";
    activity: AccountActivity;
  } | null;
}) {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const styles = createStyles(colors);
  const mapRef = useRef<MapHandle>(null);
  const [cameraMode, setCameraMode] = useState<GuidanceCameraMode>("follow");
  const cameraModeRef = useRef<GuidanceCameraMode>("follow");
  const [mapBearing, setMapBearing] = useState(0);
  const cameraSnapshotRef = useRef<MapCameraMove | null>(null);
  const [nav, setNav] = useState<NavState>({ mode: "browse", message: null, destination: null });
  const [query, setQuery] = useState("");
  const [pendingWhereTo, setPendingWhereTo] = useState<PlaceSuggestion | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deadheadContinueRef = useRef(false);
  const [finding, setFinding] = useState(false);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [fix, setFix] = useState<GeoCoordinate | null>(null);
  const [routeEpoch, setRouteEpoch] = useState(0);
  const [meter, setMeter] = useState<MeterState>(emptyMeter());
  const [upcomingSorties, setUpcomingSorties] = useState<Sortie[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  const cameraPrefs = useSyncExternalStore(
    subscribeGuidanceCameraPrefs,
    getGuidanceCameraPrefs,
    getGuidanceCameraPrefs,
  );
  const timingPrefs = useSyncExternalStore(
    subscribeGuidanceTimingPrefs,
    getGuidanceTimingPrefs,
    getGuidanceTimingPrefs,
  );
  const countdownLeadMinutes = useSyncExternalStore(
    subscribeCountdownLeadMinutes,
    getCountdownLeadMinutes,
    getCountdownLeadMinutes,
  );
  const navRef = useRef(nav);
  navRef.current = nav;
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const meterRef = useRef(meter);
  meterRef.current = meter;
  const baselineRemainingRef = useRef(0);
  const courseRef = useRef<number | null>(null);
  const compassRef = useRef<number | null>(null);
  const speedRef = useRef<number | null>(null);
  const motionRef = useRef<RouteMotion | null>(null);
  const displayedPoseRef = useRef<MotionPose | null>(null);
  const centered = useRef(false);
  const routeRequest = useRef(0);
  const choiceGeneration = useRef(0);
  const choiceChain = useRef(Promise.resolve());
  const previewCommitRef = useRef<PreviewNav | null>(null);
  const rerouteInFlight = useRef(false);
  const offRouteSinceRef = useRef<number | null>(null);
  const rerouteGeneration = useRef(0);
  const spokenKey = useRef<string | null>(null);
  const speechGeneration = useRef(0);
  const stopAdvanceInFlight = useRef(false);
  const extendWaitInFlight = useRef(false);
  const endingSortieRef = useRef(false);
  const arrivalDwellRef = useRef(emptyArrivalDwell());
  const arrivalEnteredRef = useRef(false);
  const nextDepartureRef = useRef<NextDeparture | null>(null);
  const pendingMeterRef = useRef<ReplaceMeterReadingRequest | null>(null);
  const meterSentAtRef = useRef<number | null>(null);
  const meterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" || nav.mode !== "browse") {
      return;
    }
    let cancelled = false;
    async function loadUpcoming(): Promise<void> {
      const from = new Date();
      const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
      const result = await requestCalendar(apiUrl, token, from.toISOString(), to.toISOString());
      if (cancelled) {
        return;
      }
      if (result === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (typeof result === "string") {
        return;
      }
      setUpcomingSorties(result.sorties);
    }
    void loadUpcoming();
    const poll = setInterval(() => {
      void loadUpcoming();
    }, 60_000);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void loadUpcoming();
      }
    });
    return () => {
      cancelled = true;
      clearInterval(poll);
      appState.remove();
    };
  }, [apiUrl, token, onUnauthorized, nav.mode]);

  useEffect(() => {
    if (Platform.OS === "web" || nav.mode !== "browse") {
      return;
    }
    const tick = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [nav.mode]);

  const upcoming = Platform.OS === "web" || nav.mode !== "browse" ? null : nextDeparture(upcomingSorties, new Date(clock));
  nextDepartureRef.current = upcoming;

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    const syncAlerts = (state: string): void => {
      if (state === "active") {
        void cancelDepartureAlerts();
        return;
      }
      void scheduleDepartureAlerts(nextDepartureRef.current, new Date());
    };
    syncAlerts(AppState.currentState);
    const sub = AppState.addEventListener("change", syncAlerts);
    return () => {
      sub.remove();
      void cancelDepartureAlerts();
    };
  }, []);

  const upcomingDepartAt = upcoming?.departAt.getTime() ?? null;
  useEffect(() => {
    if (Platform.OS === "web" || AppState.currentState === "active") {
      return;
    }
    void scheduleDepartureAlerts(upcoming, new Date());
  }, [upcoming?.sortieId, upcomingDepartAt]);

  function guidanceCameraFrom(at: GeoCoordinate, bearing: number): MapCamera {
    // Look-ahead keeps the fix near bottom-center on a heading-up camera.
    const target = offsetAlongBearing(at, bearing, guidanceLookAheadMeters);
    return {
      latitude: target.latitude,
      longitude: target.longitude,
      zoom: cameraPrefs.zoom,
      tilt: cameraPrefs.tilt,
      bearing,
      duration: 0,
    };
  }

  function snapshotProgressBaseline(at: GeoCoordinate | null, route: DrivingRoute): void {
    if (at && route.path.length >= 2) {
      baselineRemainingRef.current = projectOntoPath(at, route.path).remainingMeters;
      return;
    }
    baselineRemainingRef.current = pathLengthMeters(route.path) || route.distanceMeters;
  }

  function applyRouteToMeter(
    at: GeoCoordinate | null,
    route: DrivingRoute,
    previousRemainingMeters?: number,
  ): MeterState {
    const along =
      at && route.path.length >= 2 ? projectOntoPath(at, route.path).alongMeters : null;
    const next = resetMeterRouteProgress(meterRef.current, along);
    meterRef.current = next;
    setMeter(next);
    if (previousRemainingMeters === undefined) {
      snapshotProgressBaseline(at, route);
      return next;
    }
    const nextRemaining =
      at && route.path.length >= 2
        ? projectOntoPath(at, route.path).remainingMeters
        : pathLengthMeters(route.path) || route.distanceMeters;
    baselineRemainingRef.current = baselineAfterReroute(
      baselineRemainingRef.current,
      previousRemainingMeters,
      nextRemaining,
    );
    return next;
  }

  function queueMeterReport(report: ReplaceMeterReadingRequest, immediate: boolean): void {
    const previous = pendingMeterRef.current;
    pendingMeterRef.current = {
      ...report,
      ...(report.overviewPath === undefined && previous?.overviewPath ? { overviewPath: previous.overviewPath } : {}),
    };
    const delay = reportDelayMs(meterSentAtRef.current, Date.now(), immediate);
    if (meterTimerRef.current) {
      if (!immediate) {
        return;
      }
      clearTimeout(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    if (delay === 0) {
      void flushMeterReport();
      return;
    }
    meterTimerRef.current = setTimeout(() => {
      meterTimerRef.current = null;
      void flushMeterReport();
    }, delay);
  }

  async function flushMeterReport(): Promise<void> {
    const report = pendingMeterRef.current;
    pendingMeterRef.current = null;
    if (!report) {
      return;
    }
    meterSentAtRef.current = Date.now();
    const result = await replaceMeterReading(apiUrl, token, report);
    if (result === "unauthorized") {
      onUnauthorized();
    }
  }

  function publishMeter(
    nextMeter: MeterState,
    current: NavState,
    at: GeoCoordinate | null,
    options?: { immediate?: boolean; overviewPath?: GeoCoordinate[] },
  ): void {
    if (current.mode !== "guiding" && current.mode !== "arrived") {
      onMeterReading?.(null);
      return;
    }
    if (current.kind !== "sortie") {
      onMeterReading?.(null);
      return;
    }
    const dwelling = current.mode === "arrived";
    const remaining =
      dwelling
        ? 0
        : remainingDistanceMeters(at ?? current.destination, current.route, current.stepIndex);
    const step =
      current.mode === "guiding" ? current.route.steps[current.stepIndex] : undefined;
    const turnRemainingMeters =
      step === undefined
        ? 0
        : at
          ? distanceToStepEnd(at, step)
          : step.distanceMeters;
    const turnBaselineMeters = step?.distanceMeters ?? 0;
    const stopPosition = dwelling ? current.stopPosition : current.firstStopPosition;
    const later = hasLaterStop(current.stops, stopPosition);
    const final = dwelling && isFinalStop(current.stops, current.stopPosition);
    const metered = noteFlagDrop(nextMeter, sortiePassengerPresent(current));
    if (metered !== nextMeter) {
      meterRef.current = metered;
      setMeter(metered);
    }
    onMeterReading?.({
      milesTraveled: metered.milesTraveled,
      waitSeconds: metered.waitSeconds,
      remainingMeters: remaining,
      baselineRemainingMeters: baselineRemainingRef.current,
      estimatedDurationSeconds: current.route.durationSeconds,
      turnRemainingMeters,
      turnBaselineMeters,
      tariff: current.tariff,
      canArrive: current.mode === "guiding",
      dwelling,
      waitEndsAt: dwelling ? current.waitEndsAt : null,
      meterPaused: dwelling ? current.meterPaused : false,
      flashFare: dwelling && current.meterPaused,
      showOnward: Boolean(final && !current.pendingNextLeg),
      showCommence: dwelling && (later || current.pendingNextLeg),
      pendingNextLeg: dwelling ? current.pendingNextLeg : false,
      flagDropped: metered.flagDropped,
    });
    if (!current.sortieId) {
      return;
    }
    const charges = meterCharges(current.tariff, metered.milesTraveled, metered.waitSeconds, remaining);
    queueMeterReport(
      {
        sortieId: current.sortieId,
        milesTraveled: metered.milesTraveled,
        waitSeconds: metered.waitSeconds,
        totalCents: charges?.totalCents ?? 0,
        estimateCents: charges?.estimateCents ?? 0,
        remainingMeters: remaining,
        ...(options?.overviewPath ? { overviewPath: options.overviewPath } : {}),
      },
      options?.immediate === true,
    );
  }

  function resetArrivalDwell(): void {
    arrivalDwellRef.current = emptyArrivalDwell();
    arrivalEnteredRef.current = false;
  }

  function enterStopDwell(
    current: Extract<NavState, { mode: "guiding" }>,
    stopPosition: number,
    at: GeoCoordinate | null,
  ): void {
    if (current.kind !== "sortie" || arrivalEnteredRef.current) {
      return;
    }
    const stop = current.stops[stopPosition];
    if (!stop) {
      return;
    }
    arrivalEnteredRef.current = true;
    const now = Date.now();
    const final = isFinalStop(current.stops, stopPosition);
    const arrived: NavState = {
      mode: "arrived",
      kind: "sortie",
      destination: placeFromStop(stop),
      route: current.route,
      muted: current.muted,
      tariff: current.tariff,
      meter: meterRef.current,
      stops: current.stops,
      sortieId: current.sortieId,
      sortie: current.sortie,
      stopPosition,
      waitEndsAt: waitEndsAtFromStop(stop.waitMinutes, now),
      meterPaused: final,
      pendingNextLeg: false,
    };
    setNav(arrived);
    publishMeter(meterRef.current, arrived, at);
    if (current.sortieId && stop.actualArrivedAt === null) {
      const sortieId = current.sortieId;
      void (async () => {
        const result = await assertStopArrival(apiUrl, token, sortieId, stopPosition);
        if (result === "unauthorized") {
          onUnauthorized();
          return;
        }
        if (typeof result === "object") {
          setNav((existing) =>
            existing.mode === "arrived" && existing.kind === "sortie"
              ? { ...existing, stops: result.stops, sortie: result }
              : existing,
          );
        }
      })();
    }
  }

  async function runExtendWait(): Promise<void> {
    const current = navRef.current;
    if (endingSortieRef.current) {
      return;
    }
    if (current.mode !== "arrived" || current.kind !== "sortie" || !current.sortieId) {
      return;
    }
    if (extendWaitInFlight.current) {
      return;
    }
    extendWaitInFlight.current = true;
    const now = Date.now();
    const nextEnds = extendWaitEndsAt(current.waitEndsAt, now);
    const optimisticStops = bumpStopWaitMinutes(current.stops, current.stopPosition);
    const optimistic: NavState = {
      ...current,
      stops: optimisticStops,
      waitEndsAt: nextEnds,
      sortie: current.sortie
        ? { ...current.sortie, stops: optimisticStops }
        : current.sortie,
    };
    setNav(optimistic);
    publishMeter(meterRef.current, optimistic, fixRef.current);
    const result = await extendStopWait(apiUrl, token, current.sortieId, current.stopPosition);
    extendWaitInFlight.current = false;
    if (endingSortieRef.current) {
      return;
    }
    if (result === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (typeof result === "object") {
      const existing = navRef.current;
      if (endingSortieRef.current || existing.mode !== "arrived" || existing.kind !== "sortie") {
        return;
      }
      const synced: NavState = {
        ...existing,
        stops: result.stops,
        sortie: result,
        waitEndsAt: existing.waitEndsAt,
      };
      setNav(synced);
      publishMeter(meterRef.current, synced, fixRef.current);
    }
  }

  async function startNextLeg(): Promise<void> {
    const current = navRef.current;
    if (current.mode !== "arrived" || current.kind !== "sortie" || !current.sortieId) {
      return;
    }
    if (!hasLaterStop(current.stops, current.stopPosition) && !current.pendingNextLeg) {
      return;
    }
    const nextPosition = current.stopPosition + 1;
    if (!current.stops[nextPosition]) {
      return;
    }
    if (stopAdvanceInFlight.current) {
      return;
    }
    stopAdvanceInFlight.current = true;
    const generation = ++rerouteGeneration.current;
    const origin = fixRef.current ?? current.destination;
    const result = await requestSortieDrivingRoute(
      apiUrl,
      token,
      current.sortieId,
      origin,
      nextPosition,
    );
    if (generation !== rerouteGeneration.current) {
      return;
    }
    stopAdvanceInFlight.current = false;
    if (result === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (result === "failed") {
      return;
    }
    const existing = navRef.current;
    if (existing.mode !== "arrived" || existing.kind !== "sortie") {
      return;
    }
    resetArrivalDwell();
    const nextStop = existing.stops[nextPosition];
    if (!nextStop) {
      return;
    }
    const updated: NavState = {
      mode: "guiding",
      kind: "sortie",
      destination: placeFromStop(nextStop),
      route: result,
      stepIndex: 0,
      muted: existing.muted,
      offRouteSince: null,
      rerouteMessage: null,
      sortieId: existing.sortieId,
      stops: existing.stops,
      firstStopPosition: nextPosition,
      tariff: existing.tariff,
      sortie: existing.sortie,
    };
    const nextMeter = applyRouteToMeter(origin, result);
    setNav(updated);
    publishMeter(nextMeter, updated, origin);
    setRouteEpoch((epoch) => epoch + 1);
  }

  function applyOnwardSortie(updated: Sortie): void {
    const current = navRef.current;
    if (current.mode !== "arrived" || current.kind !== "sortie") {
      return;
    }
    if (updated.stops.length <= current.stopPosition) {
      return;
    }
    const arrived: NavState = {
      ...current,
      stops: updated.stops,
      sortie: updated,
      meterPaused: true,
      pendingNextLeg: hasLaterStop(updated.stops, current.stopPosition),
    };
    setNav(arrived);
    publishMeter(meterRef.current, arrived, fixRef.current);
    void uploadRevisedOverview(updated.id);
  }

  async function uploadRevisedOverview(sortieId: string): Promise<void> {
    const origin = fixRef.current;
    if (!origin) {
      return;
    }
    const result = await requestSortieDrivingRoute(apiUrl, token, sortieId, origin, 0);
    if (result === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (typeof result !== "object") {
      return;
    }
    const path = overviewPathForUpload("stops-revised", 0, result.path);
    const current = navRef.current;
    if (
      (current.mode !== "guiding" && current.mode !== "arrived") ||
      current.kind !== "sortie" ||
      current.sortieId !== sortieId
    ) {
      return;
    }
    publishMeter(meterRef.current, current, origin, { immediate: true, overviewPath: path });
  }

  useEffect(() => {
    if (!sortieGuide) {
      return;
    }
    const stop = sortieGuide.stops[sortieGuide.firstStopPosition] ?? sortieGuide.stops[sortieGuide.stops.length - 1];
    if (!stop) {
      onSortieGuideConsumed?.();
      return;
    }
    const destination = placeFromStop(stop);
    const started = emptyMeter();
    setMeter(started);
    meterRef.current = started;
    rerouteInFlight.current = false;
    stopAdvanceInFlight.current = false;
    offRouteSinceRef.current = null;
    resetArrivalDwell();
    const origin = fixRef.current;
    snapshotProgressBaseline(origin, sortieGuide.route);
    const next: NavState = {
      mode: "guiding",
      kind: "sortie",
      destination,
      route: sortieGuide.route,
      stepIndex: 0,
      muted: getGuidanceMutePrefs().muted,
      offRouteSince: null,
      rerouteMessage: null,
      sortieId: sortieGuide.sortieId,
      stops: sortieGuide.stops,
      firstStopPosition: sortieGuide.firstStopPosition,
      tariff: sortieGuide.tariff,
      sortie: sortieGuide.sortie,
    };
    setNav(next);
    setRouteEpoch((epoch) => epoch + 1);
    publishMeter(started, next, origin, {
      immediate: true,
      overviewPath: overviewPathForUpload("guidance-start", next.firstStopPosition, next.route.path),
    });
    void setActiveSortieObservation(sortieGuide.sortieId);
    onSortieGuideConsumed?.();
  }, [sortieGuide]);

  useEffect(() => {
    if (!placeGuide) {
      return;
    }
    const started = emptyMeter();
    setMeter(started);
    meterRef.current = started;
    rerouteInFlight.current = false;
    stopAdvanceInFlight.current = false;
    offRouteSinceRef.current = null;
    resetArrivalDwell();
    const origin = fixRef.current;
    snapshotProgressBaseline(origin, placeGuide.route);
    const next: NavState = {
      mode: "guiding",
      kind: "search",
      destination: placeGuide.destination,
      route: placeGuide.route,
      stepIndex: 0,
      muted: getGuidanceMutePrefs().muted,
      offRouteSince: null,
      rerouteMessage: null,
      sortieId: null,
      stops: [],
      firstStopPosition: 0,
      tariff: null,
      sortie: null,
    };
    setNav(next);
    setRouteEpoch((epoch) => epoch + 1);
    publishMeter(started, next, origin);
    void setActiveSortieObservation(null);
    onPlaceGuideConsumed?.();
  }, [placeGuide]);

  useEffect(() => {
    if (!deadhead) {
      return;
    }
    onDeadheadConsumed?.();
    if (deadhead.kind === "missing") {
      announceShortcut("That place is no longer saved.");
      return;
    }
    if (deadhead.kind === "unavailable") {
      announceShortcut("The address book could not be loaded.");
      return;
    }
    void commenceDeadhead(deadhead.destination);
  }, [deadhead]);

  const accountSortie = accountView?.activity.sortie ?? null;
  const accountStops = accountSortie ? stopListKey(accountSortie.stops) : "";
  useEffect(() => {
    if (!accountSortie) {
      return;
    }
    const current = navRef.current;
    if ((current.mode !== "guiding" && current.mode !== "arrived") || current.kind !== "sortie") {
      return;
    }
    if (current.sortieId !== accountSortie.id) {
      return;
    }
    if (stopListKey(current.stops) === accountStops) {
      return;
    }
    void uploadRevisedOverview(accountSortie.id);
  }, [accountSortie, accountStops]);

  useEffect(() => {
    let cancelled = false;
    let positionSub: Location.LocationSubscription | null = null;
    let headingSub: Location.LocationSubscription | null = null;

    async function start(): Promise<void> {
      const current = await Location.getForegroundPermissionsAsync();
      const next =
        current.status === "granted" ? current : await Location.requestForegroundPermissionsAsync();
      if (cancelled) {
        return;
      }
      if (next.status !== "granted") {
        setPermission("denied");
        return;
      }
      setPermission("granted");
      positionSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 1000,
        },
        (location) => {
          const sampleFix = { latitude: location.coords.latitude, longitude: location.coords.longitude };
          setFix(sampleFix);
          const heading = location.coords.heading;
          const nextCourse = typeof heading === "number" && heading >= 0 ? heading : null;
          courseRef.current = nextCourse;
          speedRef.current = typeof location.coords.speed === "number" ? location.coords.speed : null;
          const currentNav = navRef.current;
          if (currentNav.mode === "guiding" || currentNav.mode === "arrived") {
            motionRef.current = noteRouteFix(motionRef.current, {
              at: sampleFix,
              speedMps: speedRef.current,
              bearing: nextCourse ?? compassRef.current,
              timeMs: Date.now(),
              path: currentNav.route.path,
            });
            if (currentNav.kind === "sortie" && sortieLegBillable(currentNav)) {
              const advanced = advanceMeterAlongRoute(meterRef.current, {
                fix: sampleFix,
                observedAtMs: Date.now(),
                accuracyMeters: typeof location.coords.accuracy === "number" ? location.coords.accuracy : null,
                routePath: currentNav.route.path,
              });
              meterRef.current = advanced;
              setMeter(advanced);
              publishMeter(advanced, currentNav, sampleFix);
            }
          }
        },
      );
      if (cancelled) {
        positionSub.remove();
        return;
      }
      headingSub = await Location.watchHeadingAsync((heading) => {
        const value = heading.trueHeading >= 0 ? heading.trueHeading : heading.magHeading;
        compassRef.current = value >= 0 ? value : null;
        const motion = motionRef.current;
        if (motion && courseRef.current === null) {
          motionRef.current = noteRouteBearing(motion, compassRef.current);
        }
      });
      if (cancelled) {
        headingSub.remove();
      }
    }

    void start();
    return () => {
      cancelled = true;
      positionSub?.remove();
      headingSub?.remove();
    };
  }, []);

  useEffect(() => {
    if (!fix || nav.mode !== "browse" || centered.current || !mapRef.current) {
      return;
    }
    centered.current = true;
    mapRef.current.setCamera({ latitude: fix.latitude, longitude: fix.longitude, zoom: 15 });
  }, [fix, nav.mode]);

  const meterActive =
    (nav.mode === "guiding" || nav.mode === "arrived") && nav.kind === "sortie";
  const legBillable = meterActive && sortieLegBillable(nav);

  useEffect(() => {
    if (!meterActive || !legBillable) {
      return;
    }
    const timer = setInterval(() => {
      const current = navRef.current;
      if (!sortieLegBillable(current)) {
        return;
      }
      const ticked = tickMeterWait(meterRef.current, Date.now());
      if (ticked.waitSeconds === meterRef.current.waitSeconds && ticked.last === meterRef.current.last) {
        return;
      }
      meterRef.current = ticked;
      setMeter(ticked);
      publishMeter(ticked, current, fixRef.current);
    }, 1_000);
    return () => clearInterval(timer);
  }, [meterActive, legBillable]);

  useEffect(() => {
    if (nav.mode !== "arrived" || nav.kind !== "sortie") {
      return;
    }
    const timer = setInterval(() => {
      const current = navRef.current;
      if (current.mode !== "arrived" || current.kind !== "sortie") {
        return;
      }
      if (Date.now() < current.waitEndsAt) {
        return;
      }
      void runExtendWait();
    }, 500);
    return () => clearInterval(timer);
  }, [nav.mode, nav.mode === "arrived" && "kind" in nav && nav.kind === "sortie" ? nav.waitEndsAt : null]);

  const guidingFinalStop =
    nav.mode === "guiding" && nav.kind === "sortie" && isFinalStop(nav.stops, nav.firstStopPosition);

  useEffect(() => {
    if (!guidingFinalStop) {
      return;
    }
    const timer = setInterval(() => {
      const current = navRef.current;
      if (current.mode !== "guiding" || current.kind !== "sortie") {
        return;
      }
      if (!isFinalStop(current.stops, current.firstStopPosition)) {
        return;
      }
      const settled = settleArrivalDwell(arrivalDwellRef.current, Date.now());
      arrivalDwellRef.current = settled;
      if (!settled.satisfied) {
        return;
      }
      enterStopDwell(current, current.firstStopPosition, fixRef.current);
    }, 1_000);
    return () => clearInterval(timer);
  }, [guidingFinalStop]);

  useEffect(() => {
    const current = navRef.current;
    if (!fix || (current.mode !== "guiding" && current.mode !== "arrived")) {
      return;
    }
    if (current.mode === "arrived" && current.kind === "sortie") {
      const stop = current.stops[current.stopPosition];
      const outsideGeofence = stop ? distanceMeters(fix, stop) > arrivalMeters : false;
      const resumeMeters = timingPrefs.resumeTravelMeters;
      const resumedByGps = resumeMeters > 0 && stop ? distanceMeters(fix, stop) > resumeMeters : false;
      const later = hasLaterStop(current.stops, current.stopPosition);
      if (stop && (later || current.pendingNextLeg) && resumedByGps) {
        void startNextLeg();
      } else if (
        shouldCompleteOnLeave({
          isFinal: isFinalStop(current.stops, current.stopPosition),
          hasLaterStop: later,
          pendingNextLeg: current.pendingNextLeg,
          outsideGeofence,
          stationaryDwellMet: arrivalDwellRef.current.satisfied,
        })
      ) {
        void endGuidance();
      }
      return;
    }

    if (current.mode !== "guiding") {
      return;
    }

    if (current.kind === "sortie") {
      const target = current.stops[current.firstStopPosition];
      const inside = Boolean(target && distanceMeters(fix, target) <= arrivalMeters);
      const finalLeg = isFinalStop(current.stops, current.firstStopPosition);
      if (finalLeg) {
        const nextDwell = noteArrivalDwell(arrivalDwellRef.current, {
          inside,
          fix,
          nowMs: Date.now(),
          stationaryMeters: stationaryDisplacementMeters,
        });
        arrivalDwellRef.current = nextDwell;
        if (nextDwell.satisfied) {
          enterStopDwell(current, current.firstStopPosition, fix);
          return;
        }
        if (inside) {
          return;
        }
      } else if (inside) {
        enterStopDwell(current, current.firstStopPosition, fix);
        return;
      }
    }

    const outcome = applyLocationFix({
      fix,
      destination: current.destination,
      route: current.route,
      stepIndex: current.stepIndex,
      now: Date.now(),
      offRouteSince: offRouteSinceRef.current,
      rerouteInFlight: rerouteInFlight.current,
      stepAdvanceMeters: timingPrefs.stepAdvanceMeters,
    });
    offRouteSinceRef.current = outcome.offRouteSince;
    if (outcome.arrived) {
      if (current.kind === "sortie") {
        const finalLeg = isFinalStop(current.stops, current.firstStopPosition);
        if (!finalLeg || arrivalDwellRef.current.satisfied) {
          enterStopDwell(current, current.firstStopPosition, fix);
        }
        return;
      }
      const arrived: NavState = {
        mode: "arrived",
        kind: "search",
        destination: current.destination,
        route: current.route,
        muted: current.muted,
        tariff: current.tariff,
        meter: meterRef.current,
        stops: [],
        sortieId: null,
        sortie: null,
        stopPosition: 0,
        waitEndsAt: Date.now(),
        meterPaused: false,
        pendingNextLeg: false,
      };
      setNav(arrived);
      return;
    }
    if (outcome.stepIndex !== current.stepIndex) {
      setNav({ ...current, stepIndex: outcome.stepIndex, offRouteSince: outcome.offRouteSince });
    }
    if (!outcome.shouldReroute) {
      return;
    }
    rerouteInFlight.current = true;
    const generation = ++rerouteGeneration.current;
    const origin = fix;
    void (async () => {
      const result =
        current.kind === "sortie" && current.sortieId
          ? await requestSortieDrivingRoute(apiUrl, token, current.sortieId, origin, current.firstStopPosition)
          : await requestDrivingRoute(apiUrl, token, origin, current.destination);
      if (generation !== rerouteGeneration.current) {
        return;
      }
      rerouteInFlight.current = false;
      offRouteSinceRef.current = null;
      if (result === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (result === "failed") {
        setNav((existing) =>
          existing.mode === "guiding" ? { ...existing, rerouteMessage: "Rerouting failed." } : existing,
        );
        return;
      }
      const existing = navRef.current;
      if (existing.mode !== "guiding") {
        return;
      }
      const updated = {
        ...existing,
        route: result,
        stepIndex: 0,
        offRouteSince: null,
        rerouteMessage: null,
      };
      setNav(updated);
      if (updated.kind === "sortie") {
        const previousRemaining = remainingDistanceMeters(origin, existing.route, existing.stepIndex);
        const nextMeter = applyRouteToMeter(origin, result, previousRemaining);
        publishMeter(nextMeter, updated, origin);
      }
      setRouteEpoch((epoch) => epoch + 1);
    })();
  }, [
    fix,
    nav.mode,
    token,
    onUnauthorized,
    timingPrefs.stepAdvanceMeters,
    timingPrefs.resumeTravelMeters,
  ]);

  const guidancePath = nav.mode === "guiding" || nav.mode === "arrived" ? nav.route.path : null;
  useEffect(() => {
    const at = fixRef.current;
    if (!guidancePath || !at) {
      return;
    }
    motionRef.current = noteRouteFix(motionRef.current, {
      at,
      speedMps: speedRef.current,
      bearing: courseRef.current ?? compassRef.current,
      timeMs: Date.now(),
      path: guidancePath,
    });
  }, [guidancePath]);

  useEffect(() => {
    if (nav.mode !== "guiding" && nav.mode !== "arrived") {
      motionRef.current = null;
      displayedPoseRef.current = null;
      mapRef.current?.setDisplayedUser(null);
      return;
    }
    let frame = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) {
        return;
      }
      const motion = motionRef.current;
      if (motion) {
        const sampled = poseAt(motion, Date.now());
        motionRef.current = sampled.motion;
        const pose = sampled.pose;
        if (displayedPoseMoved(displayedPoseRef.current, pose)) {
          displayedPoseRef.current = pose;
          const at = { latitude: pose.latitude, longitude: pose.longitude };
          if (cameraModeRef.current === "follow") {
            mapRef.current?.setCamera(guidanceCameraFrom(at, pose.bearing));
          }
          mapRef.current?.setDisplayedUser(at);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      displayedPoseRef.current = null;
    };
  }, [nav.mode, cameraPrefs.zoom, cameraPrefs.tilt]);

  const overviewPath =
    cameraMode === "overview" && (nav.mode === "guiding" || nav.mode === "arrived") ? nav.route.path : null;
  useEffect(() => {
    if (!overviewPath) {
      return;
    }
    const camera = routeOverviewCamera(overviewPath);
    if (!camera) {
      return;
    }
    mapRef.current?.setCamera(camera);
  }, [overviewPath]);

  useEffect(() => {
    if (nav.mode === "guiding" || nav.mode === "arrived") {
      return;
    }
    cameraModeRef.current = "follow";
    setCameraMode((current) => (current === "follow" ? current : "follow"));
  }, [nav.mode]);

  useEffect(() => {
    void ensureGuidanceCameraPrefsLoaded();
    void ensureGuidanceTimingPrefsLoaded();
    void ensureGuidanceMutePrefsLoaded();
    void ensureCountdownLeadMinutesLoaded();
  }, []);

  useEffect(() => {
    if (nav.mode === "guiding") {
      const announceIndex = upcomingStepIndex(nav.route, nav.stepIndex);
      const announceStep = nav.route.steps[announceIndex];
      if (!announceStep) {
        return;
      }
      const key = `${routeEpoch}:${announceIndex}`;
      if (spokenKey.current === key) {
        return;
      }
      const currentStep = nav.route.steps[nav.stepIndex];
      const distance = fix
        ? distanceToUpcomingManeuver(fix, nav.route, nav.stepIndex)
        : (currentStep?.distanceMeters ?? 0);
      if (!shouldAnnounceUpcoming(distance, timingPrefs.announceLeadMeters)) {
        return;
      }
      spokenKey.current = key;
      if (!announceStep.instruction) {
        return;
      }
      if (nav.muted) {
        if (requiresCourseAdjustment(announceStep.maneuver)) {
          throb(10, turnSide(announceStep.maneuver));
        }
        return;
      }
      const generation = ++speechGeneration.current;
      void speak(generation, speechGeneration, announceStep.instruction);
      return;
    }
    if (nav.mode === "arrived") {
      if (spokenKey.current === "arrived") {
        return;
      }
      spokenKey.current = "arrived";
      if (nav.muted) {
        return;
      }
      const generation = ++speechGeneration.current;
      void speak(generation, speechGeneration, "You have arrived.");
      return;
    }
    speechGeneration.current += 1;
    spokenKey.current = null;
    void Speech.stop();
  }, [nav, routeEpoch, fix, timingPrefs.announceLeadMeters]);

  function announceShortcut(text: string): void {
    const current = navRef.current;
    const kind = shortcutNavKind(
      current.mode,
      current.mode === "guiding" || current.mode === "arrived" ? current.kind : null,
    );
    if (!shortcutMayStart(kind) || current.mode === "guiding" || current.mode === "arrived") {
      setNotice(text);
      return;
    }
    setNotice(null);
    if (current.mode === "preview") {
      setNav({ ...current, message: text });
      return;
    }
    setNav({
      mode: "browse",
      destination: current.mode === "browse" ? current.destination : null,
      message: text,
    });
  }

  async function currentOrigin(): Promise<GeoCoordinate | null> {
    const existing = fixRef.current;
    if (existing) {
      return existing;
    }
    const current = await Location.getForegroundPermissionsAsync();
    const next = current.status === "granted" ? current : await Location.requestForegroundPermissionsAsync();
    if (next.status !== "granted") {
      setPermission("denied");
      return null;
    }
    setPermission("granted");
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const origin = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      fixRef.current = origin;
      setFix(origin);
      return origin;
    } catch {
      return null;
    }
  }

  async function commenceDeadhead(suggestion: PlaceSuggestion): Promise<void> {
    const current = navRef.current;
    const kind = shortcutNavKind(
      current.mode,
      current.mode === "guiding" || current.mode === "arrived" ? current.kind : null,
    );
    if (!shortcutMayStart(kind)) {
      setNotice("A sortie is already running.");
      return;
    }
    setNotice(null);
    if ((current.mode === "guiding" || current.mode === "arrived") && current.kind === "search") {
      speechGeneration.current += 1;
      void Speech.stop();
      void setActiveSortieObservation(null);
    }
    abandonPreviewChoice();
    deadheadContinueRef.current = false;
    setQuery(suggestion.label);
    setPendingWhereTo(null);
    const requestId = ++routeRequest.current;
    const origin = await currentOrigin();
    if (requestId !== routeRequest.current) {
      return;
    }
    if (!origin) {
      setFinding(false);
      setNav({ mode: "browse", destination: suggestion, message: "Location is required." });
      return;
    }
    setFinding(true);
    setNav({ mode: "browse", destination: suggestion, message: null });

    const driver = await ensureCurrentDriver(apiUrl, token);
    if (requestId !== routeRequest.current) {
      return;
    }
    if (driver === "unauthorized") {
      setFinding(false);
      onUnauthorized();
      return;
    }
    if (driver === "unreachable") {
      setFinding(false);
      setNav({ mode: "browse", destination: suggestion, message: "The sortie was not saved." });
      return;
    }

    const reported = await reportLocationObservation(apiUrl, token, {
      observedAt: new Date().toISOString(),
      latitude: origin.latitude,
      longitude: origin.longitude,
      accuracyMeters: null,
    });
    if (requestId !== routeRequest.current) {
      return;
    }
    if (reported === "unauthorized") {
      setFinding(false);
      onUnauthorized();
      return;
    }
    if (reported !== "ok") {
      setFinding(false);
      setNav({ mode: "browse", destination: suggestion, message: "Location is required." });
      return;
    }

    const preview = await previewSortie(apiUrl, token, {
      ...whereToWrite(suggestion, false),
      sortieId: null,
    });
    if (requestId !== routeRequest.current) {
      return;
    }
    if (preview === "unauthorized") {
      setFinding(false);
      onUnauthorized();
      return;
    }
    const conflict =
      typeof preview === "string" ? null : scheduleConflictMessage(preview.endangered.map((item) => item.label));
    if (conflict) {
      setFinding(false);
      deadheadContinueRef.current = true;
      setPendingWhereTo(suggestion);
      setNav({ mode: "browse", destination: suggestion, message: conflict });
      return;
    }

    await routeAndCommenceReposition(suggestion, origin, requestId);
  }

  async function routeAndCommenceReposition(
    suggestion: PlaceSuggestion,
    origin: GeoCoordinate,
    requestId: number,
  ): Promise<void> {
    const [result, tariffResult] = await Promise.all([
      requestDrivingRoute(apiUrl, token, origin, suggestion),
      requestTariff(apiUrl, token),
    ]);
    if (requestId !== routeRequest.current) {
      return;
    }
    setFinding(false);
    if (result === "unauthorized" || tariffResult === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (result === "failed") {
      setNav({ mode: "browse", destination: suggestion, message: "The route failed." });
      return;
    }
    const tariff = typeof tariffResult === "string" ? null : tariffResult;
    const saved = await authorSortie(apiUrl, token, whereToWrite(suggestion, false));
    if (requestId !== routeRequest.current) {
      return;
    }
    if (saved === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (saved === "no-location") {
      setNav({ mode: "browse", destination: suggestion, message: "Location is required." });
      return;
    }
    if (typeof saved === "string") {
      setNav({ mode: "browse", destination: suggestion, message: "The sortie was not saved." });
      return;
    }
    const commenced = await commenceSortie(apiUrl, token, saved.id);
    if (requestId !== routeRequest.current) {
      return;
    }
    if (commenced === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (typeof commenced === "string") {
      setNav({
        mode: "browse",
        destination: suggestion,
        message: "The departure could not be recorded.",
      });
      return;
    }
    rerouteInFlight.current = false;
    stopAdvanceInFlight.current = false;
    offRouteSinceRef.current = null;
    resetArrivalDwell();
    const started = emptyMeter();
    setMeter(started);
    meterRef.current = started;
    snapshotProgressBaseline(origin, result);
    const next: NavState = {
      mode: "guiding",
      kind: "sortie",
      destination: suggestion,
      route: result,
      stepIndex: 0,
      muted: getGuidanceMutePrefs().muted,
      offRouteSince: null,
      rerouteMessage: null,
      sortieId: commenced.id,
      stops: commenced.stops,
      firstStopPosition: 0,
      tariff,
      sortie: commenced,
    };
    setNav(next);
    setRouteEpoch((epoch) => epoch + 1);
    publishMeter(started, next, origin, {
      immediate: true,
      overviewPath: overviewPathForUpload("guidance-start", next.firstStopPosition, next.route.path),
    });
    void setActiveSortieObservation(commenced.id);
  }

  async function onSelect(suggestion: PlaceSuggestion): Promise<void> {
    abandonPreviewChoice();
    deadheadContinueRef.current = false;
    setNotice(null);
    setQuery(suggestion.label);
    setPendingWhereTo(null);
    const origin = fixRef.current;
    if (permission !== "granted" || !origin) {
      setFinding(false);
      setNav({ mode: "browse", destination: suggestion, message: "Location is required." });
      return;
    }
    const requestId = ++routeRequest.current;
    setFinding(true);
    setNav({ mode: "browse", destination: suggestion, message: null });

    const driver = await ensureCurrentDriver(apiUrl, token);
    if (requestId !== routeRequest.current) {
      return;
    }
    if (driver === "unauthorized") {
      setFinding(false);
      onUnauthorized();
      return;
    }
    if (driver === "unreachable") {
      setFinding(false);
      setNav({ mode: "browse", destination: suggestion, message: "The sortie was not saved." });
      return;
    }

    const reported = await reportLocationObservation(apiUrl, token, {
      observedAt: new Date().toISOString(),
      latitude: origin.latitude,
      longitude: origin.longitude,
      accuracyMeters: null,
    });
    if (requestId !== routeRequest.current) {
      return;
    }
    if (reported === "unauthorized") {
      setFinding(false);
      onUnauthorized();
      return;
    }
    if (reported !== "ok") {
      setFinding(false);
      setNav({ mode: "browse", destination: suggestion, message: "Location is required." });
      return;
    }

    const preview = await previewSortie(apiUrl, token, {
      ...whereToWrite(suggestion, false),
      sortieId: null,
    });
    if (requestId !== routeRequest.current) {
      return;
    }
    if (preview === "unauthorized") {
      setFinding(false);
      onUnauthorized();
      return;
    }
    const conflict =
      typeof preview === "string" ? null : scheduleConflictMessage(preview.endangered.map((item) => item.label));
    if (conflict) {
      setFinding(false);
      setPendingWhereTo(suggestion);
      setNav({ mode: "browse", destination: suggestion, message: conflict });
      return;
    }

    await authorChosen(suggestion, origin, requestId);
  }

  async function onContinueWhereTo(): Promise<void> {
    const suggestion = pendingWhereTo;
    if (!suggestion) {
      return;
    }
    if (deadheadContinueRef.current) {
      deadheadContinueRef.current = false;
      const origin = await currentOrigin();
      if (!origin) {
        setPendingWhereTo(null);
        setNav({ mode: "browse", destination: suggestion, message: "Location is required." });
        return;
      }
      abandonPreviewChoice();
      const requestId = ++routeRequest.current;
      setPendingWhereTo(null);
      setFinding(true);
      setNav({ mode: "browse", destination: suggestion, message: null });
      await routeAndCommenceReposition(suggestion, origin, requestId);
      return;
    }
    const origin = fixRef.current;
    if (permission !== "granted" || !origin) {
      return;
    }
    abandonPreviewChoice();
    const requestId = ++routeRequest.current;
    setPendingWhereTo(null);
    setFinding(true);
    setNav({ mode: "browse", destination: suggestion, message: null });
    await authorChosen(suggestion, origin, requestId);
  }

  async function authorChosen(suggestion: PlaceSuggestion, origin: GeoCoordinate, requestId: number): Promise<void> {
    const [result, tariffResult] = await Promise.all([
      requestDrivingRoute(apiUrl, token, origin, suggestion),
      requestTariff(apiUrl, token),
    ]);
    if (requestId !== routeRequest.current) {
      return;
    }
    setFinding(false);
    if (result === "unauthorized" || tariffResult === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (result === "failed") {
      setNav({ mode: "browse", destination: suggestion, message: "The route failed." });
      return;
    }
    const tariff = typeof tariffResult === "string" ? null : tariffResult;
    choiceGeneration.current += 1;
    const next: PreviewNav = {
      mode: "preview",
      destination: suggestion,
      route: result,
      sortieId: null,
      stops: [],
      tariff,
      sortie: null,
      passenger: null,
      pendingPassenger: null,
      message: null,
    };
    previewCommitRef.current = next;
    setNav(next);
    const camera = overviewCamera(result.path);
    if (camera) {
      mapRef.current?.setCamera(camera);
    }
  }

  function onChooseKind(passenger: boolean): void {
    const generation = choiceGeneration.current;
    choiceChain.current = choiceChain.current
      .catch(() => undefined)
      .then(() => applyChoice(passenger, generation));
  }

  async function applyChoice(passenger: boolean, generation: number): Promise<void> {
    const current = previewCommitRef.current;
    if (generation !== choiceGeneration.current || !current) {
      return;
    }
    if (current.passenger === passenger && current.sortieId && current.pendingPassenger === null) {
      return;
    }
    const pending: PreviewNav = { ...current, pendingPassenger: passenger, message: null };
    previewCommitRef.current = pending;
    setNav(pending);
    const body = whereToWrite(current.destination, passenger);
    const saved = current.sortieId
      ? await reviseSortie(apiUrl, token, current.sortieId, body)
      : await authorSortie(apiUrl, token, body);
    if (generation !== choiceGeneration.current) {
      return;
    }
    if (saved === "unauthorized") {
      onUnauthorized();
      return;
    }
    const latest = previewCommitRef.current;
    if (!latest) {
      return;
    }
    if (saved === "no-location") {
      const failed: PreviewNav = { ...latest, pendingPassenger: null, message: "Location is required." };
      previewCommitRef.current = failed;
      setNav(failed);
      return;
    }
    if (typeof saved === "string") {
      const failed: PreviewNav = { ...latest, pendingPassenger: null, message: "The sortie was not saved." };
      previewCommitRef.current = failed;
      setNav(failed);
      return;
    }
    const committed: PreviewNav = {
      ...latest,
      passenger,
      pendingPassenger: null,
      sortieId: saved.id,
      stops: saved.stops,
      sortie: saved,
      message: null,
    };
    previewCommitRef.current = committed;
    setNav(committed);
  }

  function abandonPreviewChoice(): void {
    choiceGeneration.current += 1;
    previewCommitRef.current = null;
  }

  async function onStart(): Promise<void> {
    if (nav.mode !== "preview") {
      return;
    }
    const sortieId = nav.sortieId;
    if (sortieId === null || nav.passenger === null || nav.pendingPassenger !== null) {
      return;
    }
    const preview = nav;
    const commenced = await commenceSortie(apiUrl, token, sortieId);
    if (commenced === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (typeof commenced === "string") {
      abandonPreviewChoice();
      setNav({
        mode: "browse",
        destination: preview.destination,
        message: "The departure could not be recorded.",
      });
      return;
    }
    abandonPreviewChoice();
    rerouteInFlight.current = false;
    stopAdvanceInFlight.current = false;
    offRouteSinceRef.current = null;
    resetArrivalDwell();
    const origin = fixRef.current;
    const started = emptyMeter();
    setMeter(started);
    meterRef.current = started;
    snapshotProgressBaseline(origin, preview.route);
    const next: NavState = {
      mode: "guiding",
      kind: "sortie",
      destination: preview.destination,
      route: preview.route,
      stepIndex: 0,
      muted: getGuidanceMutePrefs().muted,
      offRouteSince: null,
      rerouteMessage: null,
      sortieId: commenced.id,
      stops: commenced.stops,
      firstStopPosition: 0,
      tariff: preview.tariff,
      sortie: commenced,
    };
    setNav(next);
    setRouteEpoch((epoch) => epoch + 1);
    publishMeter(started, next, origin, {
      immediate: true,
      overviewPath: overviewPathForUpload("guidance-start", next.firstStopPosition, next.route.path),
    });
    void setActiveSortieObservation(commenced.id);
  }

  function onDismiss(): void {
    void endGuidance();
  }

  function endSearchGuidance(): void {
    const current = navRef.current;
    if ((current.mode !== "guiding" && current.mode !== "arrived") || current.kind !== "search") {
      return;
    }
    const browse = { mode: "browse" as const, destination: null, message: null };
    navRef.current = browse;
    setNav(browse);
    abandonPreviewChoice();
    routeRequest.current += 1;
    rerouteGeneration.current += 1;
    rerouteInFlight.current = false;
    offRouteSinceRef.current = null;
    resetArrivalDwell();
    setFinding(false);
    setQuery("");
    speechGeneration.current += 1;
    void Speech.stop();
  }

  function dismissPreview(): void {
    const current = navRef.current;
    if (current.mode !== "preview") {
      return;
    }
    abandonPreviewChoice();
    deadheadContinueRef.current = false;
    routeRequest.current += 1;
    setFinding(false);
    setPendingWhereTo(null);
    setQuery("");
    const browse = { mode: "browse" as const, destination: null, message: null };
    navRef.current = browse;
    setNav(browse);
  }

  async function endGuidance(): Promise<void> {
    if (endingSortieRef.current) {
      return;
    }
    const current = navRef.current;
    const guidingId =
      (current.mode === "guiding" || current.mode === "arrived") && current.kind === "sortie"
        ? current.sortieId
        : null;
    const held = accountView?.activity.sortie;
    const heldId = held && held.actualStart !== null && held.actualEnd === null ? held.id : null;
    const sortieId = guidingId ?? heldId;
    if (!sortieId) {
      return;
    }
    endingSortieRef.current = true;
    const apiUrl = resolveApiUrl();
    const result = await completeSortie(apiUrl, token, sortieId);
    if (result === "unauthorized") {
      endingSortieRef.current = false;
      onUnauthorized();
      return;
    }
    const completed = completedSortie(result);
    if (completed === null) {
      endingSortieRef.current = false;
      return;
    }
    onSortieCompleted?.(completed);
    if (guidingId === null) {
      endingSortieRef.current = false;
      return;
    }
    const browse = { mode: "browse" as const, destination: null, message: null };
    navRef.current = browse;
    setNav(browse);
    await setActiveSortieObservation(null);
    abandonPreviewChoice();
    routeRequest.current += 1;
    rerouteGeneration.current += 1;
    rerouteInFlight.current = false;
    stopAdvanceInFlight.current = false;
    offRouteSinceRef.current = null;
    setFinding(false);
    setQuery("");
    setMeter(emptyMeter());
    meterRef.current = emptyMeter();
    baselineRemainingRef.current = 0;
    if (meterTimerRef.current) {
      clearTimeout(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    pendingMeterRef.current = null;
    meterSentAtRef.current = null;
    const cleared = await clearMeterReading(apiUrl, token);
    if (cleared === "unauthorized") {
      endingSortieRef.current = false;
      onMeterReading?.(null);
      onMeterEnded?.();
      onUnauthorized();
      return;
    }
    resetArrivalDwell();
    endingSortieRef.current = false;
    onMeterReading?.(null);
    onMeterEnded?.();
  }

  function onToggleMute(): void {
    if (nav.mode !== "guiding" && nav.mode !== "arrived") {
      return;
    }
    const muted = !nav.muted;
    if (muted) {
      speechGeneration.current += 1;
      void Speech.stop();
    }
    setNav({ ...nav, muted });
    void saveGuidanceMutePrefs({ muted });
  }

  function noteMapCamera(camera: MapCameraMove): void {
    cameraSnapshotRef.current = camera;
    setMapBearing((current) =>
      Math.abs(bearingDeltaDegrees(current, camera.bearing)) < compassBearingEpsilonDegrees
        ? current
        : camera.bearing,
    );
  }

  function onOrientNorth(): void {
    const camera = cameraSnapshotRef.current;
    if (!camera) {
      return;
    }
    mapRef.current?.setCamera({
      latitude: camera.latitude,
      longitude: camera.longitude,
      zoom: camera.zoom,
      tilt: camera.tilt,
      bearing: 0,
    });
  }

  function onToggleCameraMode(): void {
    if (nav.mode !== "guiding" && nav.mode !== "arrived") {
      return;
    }
    if (cameraModeRef.current === "overview") {
      cameraModeRef.current = "follow";
      setCameraMode("follow");
      const pose = displayedPoseRef.current;
      if (pose) {
        const at = { latitude: pose.latitude, longitude: pose.longitude };
        mapRef.current?.setCamera(guidanceCameraFrom(at, pose.bearing));
        setMapBearing((current) =>
          Math.abs(bearingDeltaDegrees(current, pose.bearing)) < compassBearingEpsilonDegrees
            ? current
            : pose.bearing,
        );
      }
      return;
    }
    cameraModeRef.current = "overview";
    setCameraMode("overview");
  }

  if (endGuidanceRef) {
    endGuidanceRef.current = onDismiss;
  }
  if (meterArriveRef) {
    meterArriveRef.current = () => {
      const current = navRef.current;
      if (current.mode !== "guiding" || current.kind !== "sortie") {
        return;
      }
      arrivalDwellRef.current = {
        anchor: fixRef.current,
        startedAtMs: Date.now(),
        satisfied: true,
      };
      enterStopDwell(current, current.firstStopPosition, fixRef.current);
    };
  }
  if (meterPlusOneRef) {
    meterPlusOneRef.current = () => {
      void runExtendWait();
    };
  }
  if (meterOnwardRef) {
    meterOnwardRef.current = () => {
      const current = navRef.current;
      if (current.mode !== "arrived" || current.kind !== "sortie" || !current.sortie) {
        return;
      }
      onOnwardDestination?.(current.sortie);
    };
  }
  if (meterCommenceRef) {
    meterCommenceRef.current = () => {
      void startNextLeg();
    };
  }
  if (applySortieUpdateRef) {
    applySortieUpdateRef.current = applyOnwardSortie;
  }

  const guiding = nav.mode === "guiding" ? nav : null;
  const arrived = nav.mode === "arrived" ? nav : null;
  const preview = nav.mode === "preview" ? nav : null;
  const showSearch = nav.mode === "browse" || nav.mode === "preview";
  const route = preview?.route ?? guiding?.route ?? arrived?.route ?? null;
  const destination = nav.destination;
  const step = guiding ? upcomingStep(guiding.route, guiding.stepIndex) : null;
  const stepDistanceMeters =
    guiding && step
      ? fix
        ? distanceToUpcomingManeuver(fix, guiding.route, guiding.stepIndex)
        : (guiding.route.steps[guiding.stepIndex]?.distanceMeters ?? step.distanceMeters)
      : 0;
  const browseMessage = nav.mode === "browse" ? nav.message : null;
  const departureRemainingMs = upcoming ? upcoming.departAt.getTime() - clock : null;
  const showCountdown =
    departureRemainingMs !== null && showDepartureCountdown(departureRemainingMs, countdownLeadMinutes);
  const meterChromeInset = meterActive ? meterPanelHeight(windowHeight) : 0;
  const compassVisible = Math.abs(bearingDeltaDegrees(0, mapBearing)) >= compassBearingEpsilonDegrees;

  useEffect(() => {
    onActiveNavigationChange?.(isActiveNavigation(nav.mode));
  }, [nav.mode, onActiveNavigationChange]);

  return (
    <View style={styles.screen}>
      <PlatformMap
        ref={mapRef}
        path={route?.path ?? []}
        destination={destination}
        user={permission === "granted" ? fix : null}
        showTraffic={guiding !== null || arrived !== null}
        followUser={nav.mode === "browse" && permission === "granted"}
        navigationZoom={cameraPrefs.zoom}
        onCameraMove={noteMapCamera}
        routeScale={minimal ? floatingRouteScale : 1}
        bare={minimal}
      />
      {minimal ? null : (
      <View
        style={[StyleSheet.absoluteFill, meterChromeInset > 0 ? { paddingBottom: meterChromeInset } : null]}
        pointerEvents="box-none"
      >
        {showSearch ? (
          <View style={styles.searchCard} pointerEvents="auto">
            <View style={styles.searchHead}>
              {networkFault ? <NetworkStatusIcon fault={networkFault} /> : null}
              <View style={styles.searchField}>
                <AddressPicker
                  placeholder="Where to?"
                  appearance="search"
                  query={query}
                  token={token}
                  bias={fix}
                  onQueryChange={(text) => {
                    routeRequest.current += 1;
                    abandonPreviewChoice();
                    deadheadContinueRef.current = false;
                    setNotice(null);
                    setFinding(false);
                    setPendingWhereTo(null);
                    setQuery(text);
                    setNav((current) =>
                      current.mode === "guiding" || current.mode === "arrived"
                        ? current
                        : { mode: "browse", destination: null, message: null },
                    );
                  }}
                  onSelect={(suggestion) => {
                    void onSelect(suggestion);
                  }}
                  onUnauthorized={onUnauthorized}
                  onSearchFailed={() => {
                    setNav((current) =>
                      current.mode === "browse" ? { ...current, message: "Search failed." } : current,
                    );
                  }}
                />
              </View>
            </View>
            {pendingWhereTo && browseMessage ? (
              <View style={styles.searchWarning}>
                <Text style={styles.searchWarningText}>{browseMessage}</Text>
                <Pressable style={styles.continueButton} onPress={() => void onContinueWhereTo()}>
                  <Text style={styles.primaryText}>Continue</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {showCountdown && upcoming && departureRemainingMs !== null ? (
          <View style={styles.countdownCard} pointerEvents="none">
            <Text style={styles.countdownTime}>{formatCountdown(departureRemainingMs)}</Text>
            <Text style={styles.countdownLabel}>Depart for {upcoming.label}</Text>
          </View>
        ) : null}

        {step ? (
          <View style={styles.maneuverCard} pointerEvents="none">
            <Text style={styles.maneuver}>{maneuverLabel(step.maneuver)}</Text>
            <Text style={styles.maneuverDistance}>{formatMeters(stepDistanceMeters)}</Text>
            <Text style={styles.instruction}>{step.instruction}</Text>
          </View>
        ) : null}
        {arrived ? (
          <View style={styles.maneuverCard} pointerEvents="none">
            <Text style={styles.maneuver}>Arrive</Text>
            <Text style={styles.instruction}>You have arrived</Text>
          </View>
        ) : null}

        <View style={styles.spacer} pointerEvents="none" />

        {compassVisible || guiding || arrived ? (
          <View style={styles.controlColumn} pointerEvents="box-none">
            {compassVisible ? (
              <Pressable
                accessibilityLabel="Orient north"
                accessibilityRole="button"
                onPress={onOrientNorth}
                style={styles.mapButton}
                pointerEvents="auto"
              >
                <View style={{ transform: [{ rotate: `${-mapBearing}deg` }] }}>
                  <Ionicons name="compass" size={24} color={colors.text} />
                </View>
              </Pressable>
            ) : null}
            {guiding?.kind === "search" || arrived?.kind === "search" ? (
              <Pressable
                accessibilityLabel="End guidance"
                accessibilityRole="button"
                onPress={endSearchGuidance}
                style={styles.mapButton}
                pointerEvents="auto"
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            ) : null}
            {guiding || arrived ? (
              <Pressable
                accessibilityLabel={cameraMode === "overview" ? "Resume driving view" : "Show full route"}
                accessibilityRole="button"
                onPress={onToggleCameraMode}
                style={styles.mapButton}
                pointerEvents="auto"
              >
                <Ionicons
                  name={cameraMode === "overview" ? "navigate" : "map-outline"}
                  size={24}
                  color={colors.text}
                />
              </Pressable>
            ) : null}
            {guiding || arrived ? (
              <Pressable
                accessibilityLabel={(guiding ?? arrived)!.muted ? "Unmute" : "Mute"}
                accessibilityRole="button"
                onPress={onToggleMute}
                style={styles.mapButton}
                pointerEvents="auto"
              >
                <Ionicons
                  name={(guiding ?? arrived)!.muted ? "volume-mute" : "volume-high"}
                  size={24}
                  color={colors.text}
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {preview ? (
          <View style={[styles.sheet, styles.startSheet]} pointerEvents="auto">
            <Text style={styles.destination}>{preview.destination.label}</Text>
            <Text style={styles.summary}>{previewSummary(preview)}</Text>
            <View style={styles.choiceRow}>
              <Pressable
                accessibilityLabel="Passenger"
                accessibilityRole="button"
                accessibilityState={{ selected: previewChoice(preview) === true }}
                onPress={() => onChooseKind(true)}
                style={[styles.choice, previewChoice(preview) === true ? styles.choiceSelected : null]}
              >
                <Text style={[styles.choiceText, previewChoice(preview) === true ? styles.choiceTextSelected : null]}>
                  Passenger
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Reposition"
                accessibilityRole="button"
                accessibilityState={{ selected: previewChoice(preview) === false }}
                onPress={() => onChooseKind(false)}
                style={[styles.choice, previewChoice(preview) === false ? styles.choiceSelected : null]}
              >
                <Text style={[styles.choiceText, previewChoice(preview) === false ? styles.choiceTextSelected : null]}>
                  Reposition
                </Text>
              </Pressable>
            </View>
            {preview.message ? <Text style={styles.message}>{preview.message}</Text> : null}
            <View style={styles.row}>
              <Pressable
                accessibilityLabel="Start"
                accessibilityRole="button"
                accessibilityState={{ disabled: !previewStartReady(preview) }}
                disabled={!previewStartReady(preview)}
                onPress={() => void onStart()}
                style={[styles.primary, previewStartReady(preview) ? null : styles.primaryDisabled]}
              >
                <Text style={styles.primaryText}>Start</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={dismissPreview}>
                <Text style={styles.secondaryText}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {notice ? (
          <View style={styles.sheet} pointerEvents="none">
            <Text style={styles.message}>{notice}</Text>
          </View>
        ) : null}

        {guiding?.rerouteMessage ? (
          <View style={styles.sheet} pointerEvents="none">
            <Text style={styles.message}>{guiding.rerouteMessage}</Text>
          </View>
        ) : null}

        {showSearch ? (
          <View style={styles.footer} pointerEvents="auto">
            {finding ? <Text style={styles.message}>Finding route…</Text> : null}
            {browseMessage && !pendingWhereTo ? <Text style={styles.message}>{browseMessage}</Text> : null}
          </View>
        ) : null}
      </View>
      )}
      {guiding || arrived ? <Awake /> : null}
    </View>
  );
}

function whereToWrite(suggestion: PlaceSuggestion, passenger: boolean): SortieWriteRequest {
  return {
    label: "",
    arrivalAt: null,
    passengerName: null,
    passengerPhone: null,
    stops: [
      {
        label: suggestion.label,
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
        waitMinutes: 0,
        passenger,
      },
    ],
  };
}

function previewChoice(preview: PreviewNav): boolean | null {
  return preview.pendingPassenger ?? preview.passenger;
}

function previewStartReady(preview: PreviewNav): boolean {
  return preview.passenger !== null && preview.sortieId !== null && preview.pendingPassenger === null;
}

function previewSummary(preview: PreviewNav): string {
  const trip = `${formatSeconds(preview.route.durationSeconds)} · ${formatMeters(preview.route.distanceMeters)}`;
  if (previewChoice(preview) !== true) {
    return trip;
  }
  return `${trip} · ${formatTripEstimate(preview.tariff, preview.route.distanceMeters)}`;
}

function placeFromStop(stop: SortieStop): PlaceSuggestion {
  return {
    label: stop.label,
    name: stop.label,
    detail: "",
    latitude: stop.latitude,
    longitude: stop.longitude,
  };
}

/** The current stop has a passenger, including a paused final stop that already dropped the flag. */
function sortiePassengerPresent(nav: NavState): boolean {
  if ((nav.mode !== "guiding" && nav.mode !== "arrived") || nav.kind !== "sortie") {
    return false;
  }
  if (nav.mode === "arrived") {
    return nav.stops[nav.stopPosition]?.passenger === true;
  }
  return nav.stops[nav.firstStopPosition]?.passenger === true;
}

/** Meter accrues only while the current leg has passenger on and the meter is not paused. */
function sortieLegBillable(nav: NavState): boolean {
  if (nav.mode === "arrived" && nav.meterPaused) {
    return false;
  }
  return sortiePassengerPresent(nav);
}

function Awake() {
  useKeepAwake();
  return null;
}

async function speak(
  generation: number,
  generations: { current: number },
  text: string,
): Promise<void> {
  await Speech.stop();
  if (generations.current !== generation) {
    return;
  }
  Speech.speak(text);
}

function createStyles(colors: ThemeColors) {
  const mapChrome = withAlpha(colors.surfaceMuted, 0.5);
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    searchCard: {
      margin: 12,
      backgroundColor: mapChrome,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 12,
      overflow: "hidden",
    },
    searchHead: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    searchField: {
      flex: 1,
    },
    searchWarning: {
      paddingHorizontal: 12,
      paddingBottom: 12,
      gap: 8,
    },
    searchWarningText: {
      fontSize: 16,
      color: colors.text,
    },
    countdownCard: {
      marginHorizontal: 12,
      marginTop: 4,
      backgroundColor: mapChrome,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    countdownTime: {
      fontSize: 28,
      fontWeight: "700",
      color: colors.text,
    },
    countdownLabel: {
      marginTop: 4,
      fontSize: 15,
      color: colors.textSecondary,
    },
    maneuverCard: {
      marginHorizontal: 12,
      marginTop: 8,
      backgroundColor: mapChrome,
      borderRadius: 12,
      padding: 16,
    },
    maneuver: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    maneuverDistance: {
      fontSize: 36,
      fontWeight: "700",
      marginTop: 4,
      color: colors.text,
    },
    instruction: {
      fontSize: 18,
      marginTop: 4,
      color: colors.text,
    },
    spacer: {
      flex: 1,
    },
    controlColumn: {
      position: "absolute",
      right: 12,
      top: 0,
      bottom: 0,
      justifyContent: "center",
      gap: 12,
    },
    mapButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: withAlpha(colors.surface, 0.85),
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    sheet: {
      margin: 12,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
    },
    startSheet: {
      backgroundColor: mapChrome,
    },
    destination: {
      fontSize: 18,
      color: colors.text,
    },
    summary: {
      fontSize: 20,
      marginTop: 6,
      color: colors.text,
    },
    choiceRow: {
      flexDirection: "row",
      gap: 12,
      marginTop: 16,
    },
    choice: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: "center",
      backgroundColor: colors.surfaceMuted,
    },
    choiceSelected: {
      backgroundColor: colors.accent,
    },
    choiceText: {
      fontSize: 18,
      color: colors.text,
    },
    choiceTextSelected: {
      color: "#fff",
      fontWeight: "600",
    },
    row: {
      flexDirection: "row",
      gap: 12,
      marginTop: 16,
    },
    primary: {
      flex: 1,
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: "center",
    },
    primaryText: {
      color: "#fff",
      fontSize: 18,
      fontWeight: "600",
    },
    primaryDisabled: {
      opacity: 0.4,
    },
    secondary: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: "center",
      backgroundColor: colors.surfaceMuted,
    },
    secondaryText: {
      fontSize: 18,
      color: colors.text,
    },
    footer: {
      alignItems: "center",
      paddingBottom: 12,
      gap: 8,
    },
    continueButton: {
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 14,
      paddingHorizontal: 24,
      alignItems: "center",
    },
    message: {
      textAlign: "center",
      fontSize: 16,
      marginTop: 8,
      color: colors.text,
    },
  });
}
