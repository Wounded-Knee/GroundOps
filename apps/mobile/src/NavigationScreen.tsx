import type { DrivingRoute, GeoCoordinate, PlaceSuggestion, Sortie, SortieStop, Tariff } from "@groundops/contracts";
import { Ionicons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AddressPicker } from "./AddressPicker";
import { useTheme } from "./ThemeProvider";
import { withAlpha, type ThemeColors } from "./theme";
import { resolveApiUrl } from "./apiUrl";
import {
  assertStopArrival,
  authorSortie,
  commenceSortie,
  completeSortie,
  ensureCurrentDriver,
  extendStopWait,
  reportLocationObservation,
  requestCalendar,
  requestTariff,
} from "./calendarClient";
import { setActiveSortieObservation } from "./locationObservationReporting";
import { cancelDepartureAlerts, scheduleDepartureAlerts } from "./departureAlerts";
import { formatCountdown, nextDeparture, type NextDeparture } from "./nextDeparture";
import {
  applyLocationFix,
  arrivalMeters,
  distanceMeters,
  distanceToStepEnd,
  distanceToUpcomingManeuver,
  formatMeters,
  formatSeconds,
  guidanceLookAheadMeters,
  maneuverLabel,
  offsetAlongBearing,
  overviewCamera,
  pathLengthMeters,
  projectOntoPath,
  remainingDistanceMeters,
  shouldAnnounceUpcoming,
  smoothBearing,
  travelBearing,
  upcomingStep,
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
  emptyMeter,
  formatTripEstimate,
  resetMeterRouteProgress,
  tickMeterWait,
  type MeterState,
} from "./meter";
import type { MeterDisplay } from "./MeterStrip";
import { PlatformMap, type MapCamera, type MapHandle } from "./PlatformMap";
import { requestDrivingRoute, requestSortieDrivingRoute } from "./routingClient";
import {
  bumpStopWaitMinutes,
  extendWaitEndsAt,
  hasLaterStop,
  isFinalStop,
  waitEndsAtFromStop,
} from "./sortieDwell";
import type { SortieGuideCommand } from "./sortieGuide";
import { throb } from "./VisualAlert";

export type { SortieGuideCommand } from "./sortieGuide";

type NavState =
  | { mode: "browse"; message: string | null; destination: PlaceSuggestion | null }
  | {
      mode: "preview";
      destination: PlaceSuggestion;
      route: DrivingRoute;
      sortieId: string;
      stops: SortieStop[];
      tariff: Tariff | null;
      sortie: Sortie;
    }
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

export function NavigationScreen({
  token,
  onUnauthorized,
  sortieGuide = null,
  onSortieGuideConsumed,
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
}: {
  token: string;
  onUnauthorized: () => void;
  sortieGuide?: SortieGuideCommand | null;
  onSortieGuideConsumed?: () => void;
  onMeterReading?: (reading: MeterDisplay | null) => void;
  onMeterEnded?: () => void;
  onSortieCompleted?: () => void;
  onOnwardDestination?: (sortie: Sortie) => void;
  endGuidanceRef?: MutableRefObject<(() => void) | null>;
  meterArriveRef?: MutableRefObject<(() => void) | null>;
  meterPlusOneRef?: MutableRefObject<(() => void) | null>;
  meterOnwardRef?: MutableRefObject<(() => void) | null>;
  meterCommenceRef?: MutableRefObject<(() => void) | null>;
  applySortieUpdateRef?: MutableRefObject<((sortie: Sortie) => void) | null>;
}) {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const styles = createStyles(colors);
  const mapRef = useRef<MapHandle>(null);
  const [nav, setNav] = useState<NavState>({ mode: "browse", message: null, destination: null });
  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [fix, setFix] = useState<GeoCoordinate | null>(null);
  const [course, setCourse] = useState<number | null>(null);
  const [compass, setCompass] = useState<number | null>(null);
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
  const navRef = useRef(nav);
  navRef.current = nav;
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const meterRef = useRef(meter);
  meterRef.current = meter;
  const baselineRemainingRef = useRef(0);
  const bearingRef = useRef<number | null>(null);
  const centered = useRef(false);
  const routeRequest = useRef(0);
  const rerouteInFlight = useRef(false);
  const offRouteSinceRef = useRef<number | null>(null);
  const rerouteGeneration = useRef(0);
  const spokenKey = useRef<string | null>(null);
  const speechGeneration = useRef(0);
  const guidedCameraRef = useRef<MapCamera | null>(null);
  const stopAdvanceInFlight = useRef(false);
  const extendWaitInFlight = useRef(false);
  const nextDepartureRef = useRef<NextDeparture | null>(null);

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

  function sendGuidanceCamera(camera: MapCamera): void {
    const previous = guidedCameraRef.current;
    const unchanged =
      previous !== null &&
      previous.latitude === camera.latitude &&
      previous.longitude === camera.longitude &&
      previous.zoom === camera.zoom &&
      previous.tilt === camera.tilt &&
      previous.bearing === camera.bearing;
    if (unchanged) {
      return;
    }
    guidedCameraRef.current = camera;
    mapRef.current?.setCamera(camera);
  }

  function guidanceCameraFrom(at: GeoCoordinate): MapCamera {
    const bearing = bearingRef.current ?? 0;
    // Look-ahead keeps the fix near bottom-center on a heading-up camera.
    const target = offsetAlongBearing(at, bearing, guidanceLookAheadMeters);
    return {
      latitude: target.latitude,
      longitude: target.longitude,
      zoom: cameraPrefs.zoom,
      tilt: cameraPrefs.tilt,
      bearing,
    };
  }

  function snapshotProgressBaseline(at: GeoCoordinate | null, route: DrivingRoute): void {
    if (at && route.path.length >= 2) {
      baselineRemainingRef.current = projectOntoPath(at, route.path).remainingMeters;
      return;
    }
    baselineRemainingRef.current = pathLengthMeters(route.path) || route.distanceMeters;
  }

  function applyRouteToMeter(at: GeoCoordinate | null, route: DrivingRoute): MeterState {
    const along =
      at && route.path.length >= 2 ? projectOntoPath(at, route.path).alongMeters : null;
    const next = resetMeterRouteProgress(meterRef.current, along);
    meterRef.current = next;
    setMeter(next);
    snapshotProgressBaseline(at, route);
    return next;
  }

  function publishMeter(nextMeter: MeterState, current: NavState, at: GeoCoordinate | null): void {
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
    onMeterReading?.({
      milesTraveled: nextMeter.milesTraveled,
      waitSeconds: nextMeter.waitSeconds,
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
    });
  }

  function enterStopDwell(
    current: Extract<NavState, { mode: "guiding" }>,
    stopPosition: number,
    at: GeoCoordinate | null,
  ): void {
    if (current.kind !== "sortie") {
      return;
    }
    const stop = current.stops[stopPosition];
    if (!stop) {
      return;
    }
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
    if (result === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (typeof result === "object") {
      const existing = navRef.current;
      if (existing.mode !== "arrived" || existing.kind !== "sortie") {
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
    bearingRef.current = travelBearing(course, compass);
    rerouteInFlight.current = false;
    stopAdvanceInFlight.current = false;
    offRouteSinceRef.current = null;
    const origin = fixRef.current;
    if (origin) {
      sendGuidanceCamera(guidanceCameraFrom(origin));
    }
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
    publishMeter(started, next, origin);
    void setActiveSortieObservation(sortieGuide.sortieId);
    onSortieGuideConsumed?.();
  }, [sortieGuide]);

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
          setCourse(nextCourse);
          const currentNav = navRef.current;
          if (currentNav.mode === "guiding" || currentNav.mode === "arrived") {
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
        setCompass(value >= 0 ? value : null);
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

  // Prefer GPS course for the camera; only follow compass when course is absent so
  // high-rate heading ticks do not restart Android camera animations.
  const bearingInput = course !== null && course >= 0 ? course : compass;

  useEffect(() => {
    const current = navRef.current;
    if (!fix || (current.mode !== "guiding" && current.mode !== "arrived")) {
      guidedCameraRef.current = null;
      return;
    }
    if (bearingInput !== null) {
      bearingRef.current = smoothBearing(bearingRef.current, bearingInput);
    }
    sendGuidanceCamera(guidanceCameraFrom(fix));
    if (current.mode === "arrived" && current.kind === "sortie") {
      const stop = current.stops[current.stopPosition];
      if (
        stop &&
        (hasLaterStop(current.stops, current.stopPosition) || current.pendingNextLeg) &&
        distanceMeters(fix, stop) > arrivalMeters
      ) {
        void startNextLeg();
      }
      return;
    }

    if (current.mode !== "guiding") {
      return;
    }

    if (current.kind === "sortie") {
      const target = current.stops[current.firstStopPosition];
      if (target && distanceMeters(fix, target) <= arrivalMeters) {
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
        enterStopDwell(current, current.firstStopPosition, fix);
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
        const nextMeter = applyRouteToMeter(origin, result);
        publishMeter(nextMeter, updated, origin);
      }
      setRouteEpoch((epoch) => epoch + 1);
    })();
  }, [
    fix,
    bearingInput,
    nav.mode,
    token,
    onUnauthorized,
    cameraPrefs.zoom,
    cameraPrefs.tilt,
    timingPrefs.stepAdvanceMeters,
  ]);

  useEffect(() => {
    void ensureGuidanceCameraPrefsLoaded();
    void ensureGuidanceTimingPrefsLoaded();
    void ensureGuidanceMutePrefsLoaded();
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
        throb(10);
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

  async function onSelect(suggestion: PlaceSuggestion): Promise<void> {
    setQuery(suggestion.label);
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

    const authored = await authorSortie(apiUrl, token, {
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
          passenger: true,
        },
      ],
    });
    if (requestId !== routeRequest.current) {
      return;
    }
    if (authored === "unauthorized") {
      setFinding(false);
      onUnauthorized();
      return;
    }
    if (authored === "no-location") {
      setFinding(false);
      setNav({ mode: "browse", destination: suggestion, message: "Location is required." });
      return;
    }
    if (typeof authored === "string") {
      setFinding(false);
      setNav({ mode: "browse", destination: suggestion, message: "The sortie was not saved." });
      return;
    }

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
    setNav({
      mode: "preview",
      destination: suggestion,
      route: result,
      sortieId: authored.id,
      stops: authored.stops,
      tariff,
      sortie: authored,
    });
    const camera = overviewCamera(result.path);
    if (camera) {
      mapRef.current?.setCamera(camera);
    }
  }

  async function onStart(): Promise<void> {
    if (nav.mode !== "preview") {
      return;
    }
    const preview = nav;
    const commenced = await commenceSortie(apiUrl, token, preview.sortieId);
    if (commenced === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (typeof commenced === "string") {
      setNav({
        mode: "browse",
        destination: preview.destination,
        message: "The departure could not be recorded.",
      });
      return;
    }
    bearingRef.current = travelBearing(course, compass);
    rerouteInFlight.current = false;
    stopAdvanceInFlight.current = false;
    offRouteSinceRef.current = null;
    const origin = fixRef.current;
    if (origin) {
      sendGuidanceCamera(guidanceCameraFrom(origin));
    }
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
    publishMeter(started, next, origin);
    void setActiveSortieObservation(commenced.id);
  }

  function onDismiss(): void {
    void endGuidance();
  }

  async function endGuidance(): Promise<void> {
    const current = navRef.current;
    const apiUrl = resolveApiUrl();
    if (
      (current.mode === "guiding" || current.mode === "arrived") &&
      current.kind === "sortie" &&
      current.sortieId
    ) {
      const completed = await completeSortie(apiUrl, token, current.sortieId);
      if (completed === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (typeof completed === "object") {
        onSortieCompleted?.();
      }
    }
    await setActiveSortieObservation(null);
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
    setNav({ mode: "browse", destination: null, message: null });
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

  if (endGuidanceRef) {
    endGuidanceRef.current = onDismiss;
  }
  if (meterArriveRef) {
    meterArriveRef.current = () => {
      const current = navRef.current;
      if (current.mode !== "guiding" || current.kind !== "sortie") {
        return;
      }
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
  const meterChromeInset = meterActive ? windowHeight * 0.25 : 0;

  return (
    <View style={styles.screen}>
      <PlatformMap
        ref={mapRef}
        path={route?.path ?? []}
        destination={destination}
        user={permission === "granted" ? fix : null}
        showTraffic={guiding !== null || arrived !== null}
        followUser={nav.mode === "browse" && permission === "granted"}
      />
      <View
        style={[StyleSheet.absoluteFill, meterChromeInset > 0 ? { paddingBottom: meterChromeInset } : null]}
        pointerEvents="box-none"
      >
        {showSearch ? (
          <View style={styles.searchCard} pointerEvents="auto">
            <AddressPicker
              placeholder="Where to?"
              appearance="search"
              query={query}
              token={token}
              bias={fix}
              onQueryChange={(text) => {
                routeRequest.current += 1;
                setFinding(false);
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
        ) : null}

        {upcoming ? (
          <View style={styles.countdownCard} pointerEvents="none">
            <Text style={styles.countdownTime}>{formatCountdown(upcoming.departAt.getTime() - clock)}</Text>
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

        {guiding || arrived ? (
          <View style={styles.muteRail} pointerEvents="box-none">
            <Pressable
              accessibilityLabel={(guiding ?? arrived)!.muted ? "Unmute" : "Mute"}
              accessibilityRole="button"
              onPress={onToggleMute}
              style={styles.muteButton}
              pointerEvents="auto"
            >
              <Ionicons
                name={(guiding ?? arrived)!.muted ? "volume-mute" : "volume-high"}
                size={24}
                color={colors.text}
              />
            </Pressable>
          </View>
        ) : null}

        {preview ? (
          <View style={styles.sheet} pointerEvents="auto">
            <Text style={styles.destination}>{preview.destination.label}</Text>
            <Text style={styles.summary}>
              {formatSeconds(preview.route.durationSeconds)} · {formatMeters(preview.route.distanceMeters)}
              {" · "}
              {formatTripEstimate(preview.tariff, preview.route.distanceMeters)}
            </Text>
            <View style={styles.row}>
              <Pressable style={styles.primary} onPress={onStart}>
                <Text style={styles.primaryText}>Start</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={onDismiss}>
                <Text style={styles.secondaryText}>Dismiss</Text>
              </Pressable>
            </View>
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
            {browseMessage ? <Text style={styles.message}>{browseMessage}</Text> : null}
          </View>
        ) : null}
      </View>
      {guiding || arrived ? <Awake /> : null}
    </View>
  );
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

/** Meter accrues only while the current leg has passenger on and the meter is not paused. */
function sortieLegBillable(nav: NavState): boolean {
  if ((nav.mode !== "guiding" && nav.mode !== "arrived") || nav.kind !== "sortie") {
    return false;
  }
  if (nav.mode === "arrived") {
    if (nav.meterPaused) {
      return false;
    }
    return nav.stops[nav.stopPosition]?.passenger === true;
  }
  return nav.stops[nav.firstStopPosition]?.passenger === true;
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
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    searchCard: {
      margin: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 12,
      overflow: "hidden",
    },
    countdownCard: {
      marginHorizontal: 12,
      marginTop: 4,
      backgroundColor: withAlpha(colors.surface, 0.92),
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
      backgroundColor: withAlpha(colors.surface, 0.3),
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
    muteRail: {
      position: "absolute",
      right: 12,
      top: 0,
      bottom: 0,
      justifyContent: "center",
    },
    muteButton: {
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
    destination: {
      fontSize: 18,
      color: colors.text,
    },
    summary: {
      fontSize: 20,
      marginTop: 6,
      color: colors.text,
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
    message: {
      textAlign: "center",
      fontSize: 16,
      marginTop: 8,
      color: colors.text,
    },
  });
}
