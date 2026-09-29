import type { DrivingRoute, GeoCoordinate, PlaceSuggestion, SortieStop, Tariff } from "@groundops/contracts";
import { useKeepAwake } from "expo-keep-awake";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AddressPicker } from "./AddressPicker";
import { resolveApiUrl } from "./apiUrl";
import { authorSortie, ensureCurrentDriver, reportLocationObservation, requestTariff } from "./calendarClient";
import {
  applyLocationFix,
  arrivalMeters,
  distanceMeters,
  distanceToStepEnd,
  formatMeters,
  formatSeconds,
  guidanceTilt,
  guidanceZoom,
  maneuverLabel,
  overviewCamera,
  remainingDistanceMeters,
  remainingDurationSeconds,
  travelBearing,
} from "./guidance";
import { advanceMeter, emptyMeter, tickMeterWait, type MeterState } from "./meter";
import type { MeterDisplay } from "./MeterStrip";
import { PlatformMap, type MapCamera, type MapHandle } from "./PlatformMap";
import { requestDrivingRoute, requestSortieDrivingRoute } from "./routingClient";
import type { SortieGuideCommand } from "./sortieGuide";

export type { SortieGuideCommand } from "./sortieGuide";

type NavState =
  | { mode: "browse"; message: string | null; destination: PlaceSuggestion | null }
  | {
      mode: "preview";
      destination: PlaceSuggestion;
      route: DrivingRoute;
      sortieId: string;
      stops: SortieStop[];
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
    }
  | {
      mode: "arrived";
      kind: "search" | "sortie";
      destination: PlaceSuggestion;
      route: DrivingRoute;
      muted: boolean;
      tariff: Tariff | null;
      meter: MeterState;
    };

const apiUrl = resolveApiUrl();

export function NavigationScreen({
  token,
  onUnauthorized,
  sortieGuide = null,
  onSortieGuideConsumed,
  onMeterReading,
  onMeterEnded,
}: {
  token: string;
  onUnauthorized: () => void;
  sortieGuide?: SortieGuideCommand | null;
  onSortieGuideConsumed?: () => void;
  onMeterReading?: (reading: MeterDisplay | null) => void;
  onMeterEnded?: () => void;
}) {
  const mapRef = useRef<MapHandle>(null);
  const [nav, setNav] = useState<NavState>({ mode: "browse", message: null, destination: null });
  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [fix, setFix] = useState<GeoCoordinate | null>(null);
  const [course, setCourse] = useState<number | null>(null);
  const [compass, setCompass] = useState<number | null>(null);
  const [routeEpoch, setRouteEpoch] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [meter, setMeter] = useState<MeterState>(emptyMeter());

  const navRef = useRef(nav);
  navRef.current = nav;
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const meterRef = useRef(meter);
  meterRef.current = meter;
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

  function publishMeter(nextMeter: MeterState, current: NavState, at: GeoCoordinate | null): void {
    if (current.mode !== "guiding" && current.mode !== "arrived") {
      onMeterReading?.(null);
      return;
    }
    if (current.kind !== "sortie") {
      onMeterReading?.(null);
      return;
    }
    const remaining =
      current.mode === "arrived"
        ? 0
        : remainingDistanceMeters(at ?? current.destination, current.route, current.stepIndex);
    onMeterReading?.({
      milesTraveled: nextMeter.milesTraveled,
      waitSeconds: nextMeter.waitSeconds,
      remainingMeters: remaining,
      tariff: current.tariff,
    });
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
    bearingRef.current = travelBearing(course, compass);
    rerouteInFlight.current = false;
    stopAdvanceInFlight.current = false;
    offRouteSinceRef.current = null;
    const origin = fixRef.current;
    if (origin) {
      sendGuidanceCamera({
        latitude: origin.latitude,
        longitude: origin.longitude,
        zoom: guidanceZoom,
        tilt: guidanceTilt,
        bearing: bearingRef.current ?? 0,
      });
    }
    const next: NavState = {
      mode: "guiding",
      kind: "sortie",
      destination,
      route: sortieGuide.route,
      stepIndex: 0,
      muted: false,
      offRouteSince: null,
      rerouteMessage: null,
      sortieId: sortieGuide.sortieId,
      stops: sortieGuide.stops,
      firstStopPosition: sortieGuide.firstStopPosition,
      tariff: sortieGuide.tariff,
    };
    setNav(next);
    setRouteEpoch((epoch) => epoch + 1);
    publishMeter(started, next, origin);
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
          setCourse(typeof heading === "number" && heading >= 0 ? heading : null);
          const currentNav = navRef.current;
          if (currentNav.mode === "guiding" || currentNav.mode === "arrived") {
            if (currentNav.kind === "sortie") {
              const advanced = advanceMeter(meterRef.current, {
                fix: sampleFix,
                observedAtMs: Date.now(),
                accuracyMeters: typeof location.coords.accuracy === "number" ? location.coords.accuracy : null,
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

  useEffect(() => {
    if (!meterActive) {
      return;
    }
    const timer = setInterval(() => {
      const current = navRef.current;
      if (current.mode !== "guiding" && current.mode !== "arrived") {
        return;
      }
      if (current.kind !== "sortie") {
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
  }, [meterActive]);

  useEffect(() => {
    if (nav.mode !== "guiding" && nav.mode !== "arrived") {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [nav.mode]);

  useEffect(() => {
    const current = navRef.current;
    if (!fix || (current.mode !== "guiding" && current.mode !== "arrived")) {
      guidedCameraRef.current = null;
      return;
    }
    const observed = travelBearing(course, compass);
    if (observed !== null) {
      bearingRef.current = observed;
    }
    sendGuidanceCamera({
      latitude: fix.latitude,
      longitude: fix.longitude,
      zoom: guidanceZoom,
      tilt: guidanceTilt,
      bearing: bearingRef.current ?? 0,
    });
    if (current.mode !== "guiding") {
      return;
    }

    if (current.kind === "sortie") {
      const target = current.stops[current.firstStopPosition];
      const lastIndex = current.stops.length - 1;
      if (target && distanceMeters(fix, target) <= arrivalMeters) {
        if (current.firstStopPosition >= lastIndex) {
          const arrived: NavState = {
            mode: "arrived",
            kind: "sortie",
            destination: current.destination,
            route: current.route,
            muted: current.muted,
            tariff: current.tariff,
            meter: meterRef.current,
          };
          setNav(arrived);
          publishMeter(meterRef.current, arrived, fix);
          return;
        }
        if (!stopAdvanceInFlight.current && current.sortieId) {
          stopAdvanceInFlight.current = true;
          const nextPosition = current.firstStopPosition + 1;
          const generation = ++rerouteGeneration.current;
          const origin = fix;
          const sortieId = current.sortieId;
          void (async () => {
            const result = await requestSortieDrivingRoute(apiUrl, token, sortieId, origin, nextPosition);
            if (generation !== rerouteGeneration.current) {
              return;
            }
            stopAdvanceInFlight.current = false;
            if (result === "unauthorized") {
              onUnauthorized();
              return;
            }
            if (result === "failed") {
              setNav((existing) =>
                existing.mode === "guiding" && existing.kind === "sortie"
                  ? { ...existing, rerouteMessage: "Rerouting failed." }
                  : existing,
              );
              return;
            }
            const existing = navRef.current;
            if (existing.mode !== "guiding" || existing.kind !== "sortie") {
              return;
            }
            const nextStop = existing.stops[nextPosition] ?? existing.stops[existing.stops.length - 1];
            if (!nextStop) {
              return;
            }
            const updated = {
              ...existing,
              destination: placeFromStop(nextStop),
              route: result,
              stepIndex: 0,
              firstStopPosition: nextPosition,
              offRouteSince: null,
              rerouteMessage: null,
            };
            setNav(updated);
            publishMeter(meterRef.current, updated, origin);
            setRouteEpoch((epoch) => epoch + 1);
          })();
        }
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
    });
    offRouteSinceRef.current = outcome.offRouteSince;
    if (outcome.arrived) {
      const arrived: NavState = {
        mode: "arrived",
        kind: current.kind,
        destination: current.destination,
        route: current.route,
        muted: current.muted,
        tariff: current.tariff,
        meter: meterRef.current,
      };
      setNav(arrived);
      if (current.kind === "sortie") {
        publishMeter(meterRef.current, arrived, fix);
      }
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
        publishMeter(meterRef.current, updated, origin);
      }
      setRouteEpoch((epoch) => epoch + 1);
    })();
  }, [fix, course, compass, nav.mode, token, onUnauthorized]);

  useEffect(() => {
    if (nav.mode === "guiding") {
      const key = `${routeEpoch}:${nav.stepIndex}`;
      if (spokenKey.current === key) {
        return;
      }
      spokenKey.current = key;
      const instruction = nav.route.steps[nav.stepIndex]?.instruction;
      if (!instruction || nav.muted) {
        return;
      }
      const generation = ++speechGeneration.current;
      void speak(generation, speechGeneration, instruction);
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
  }, [nav, routeEpoch]);

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
          role: "destination",
          label: suggestion.label,
          latitude: suggestion.latitude,
          longitude: suggestion.longitude,
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

    const result = await requestDrivingRoute(apiUrl, token, origin, suggestion);
    if (requestId !== routeRequest.current) {
      return;
    }
    setFinding(false);
    if (result === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (result === "failed") {
      setNav({ mode: "browse", destination: suggestion, message: "The route failed." });
      return;
    }
    setNav({
      mode: "preview",
      destination: suggestion,
      route: result,
      sortieId: authored.id,
      stops: authored.stops,
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
    bearingRef.current = travelBearing(course, compass);
    rerouteInFlight.current = false;
    stopAdvanceInFlight.current = false;
    offRouteSinceRef.current = null;
    const origin = fixRef.current;
    if (origin) {
      sendGuidanceCamera({
        latitude: origin.latitude,
        longitude: origin.longitude,
        zoom: guidanceZoom,
        tilt: guidanceTilt,
        bearing: bearingRef.current ?? 0,
      });
    }
    const tariffResult = await requestTariff(apiUrl, token);
    if (tariffResult === "unauthorized") {
      onUnauthorized();
      return;
    }
    const tariff = typeof tariffResult === "string" ? null : tariffResult;
    const started = emptyMeter();
    setMeter(started);
    const next: NavState = {
      mode: "guiding",
      kind: "sortie",
      destination: nav.destination,
      route: nav.route,
      stepIndex: 0,
      muted: false,
      offRouteSince: null,
      rerouteMessage: null,
      sortieId: nav.sortieId,
      stops: nav.stops,
      firstStopPosition: 0,
      tariff,
    };
    setNav(next);
    setRouteEpoch((epoch) => epoch + 1);
    publishMeter(started, next, origin);
  }

  function onDismiss(): void {
    routeRequest.current += 1;
    rerouteGeneration.current += 1;
    rerouteInFlight.current = false;
    stopAdvanceInFlight.current = false;
    offRouteSinceRef.current = null;
    setFinding(false);
    setQuery("");
    setMeter(emptyMeter());
    setNav({ mode: "browse", destination: null, message: null });
    onMeterReading?.(null);
    onMeterEnded?.();
  }

  function onMute(): void {
    setNav((current) => {
      if (current.mode !== "guiding" && current.mode !== "arrived") {
        return current;
      }
      const muted = !current.muted;
      if (muted) {
        void Speech.stop();
      }
      return { ...current, muted };
    });
  }

  const guiding = nav.mode === "guiding" ? nav : null;
  const arrived = nav.mode === "arrived" ? nav : null;
  const preview = nav.mode === "preview" ? nav : null;
  const showSearch = nav.mode === "browse" || nav.mode === "preview";
  const route = preview?.route ?? guiding?.route ?? arrived?.route ?? null;
  const destination = nav.destination;
  const step = guiding ? guiding.route.steps[guiding.stepIndex] : null;
  const browseMessage = nav.mode === "browse" ? nav.message : null;

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
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
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

        {step ? (
          <View style={styles.maneuverCard} pointerEvents="none">
            <Text style={styles.maneuver}>{maneuverLabel(step.maneuver)}</Text>
            <Text style={styles.maneuverDistance}>{formatMeters(fix ? distanceToStepEnd(fix, step) : step.distanceMeters)}</Text>
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

        {preview ? (
          <View style={styles.sheet} pointerEvents="auto">
            <Text style={styles.destination}>{preview.destination.label}</Text>
            <Text style={styles.summary}>
              {formatSeconds(preview.route.durationSeconds)} · {formatMeters(preview.route.distanceMeters)}
            </Text>
            <View style={styles.row}>
              <Pressable style={styles.primary} onPress={() => void onStart()}>
                <Text style={styles.primaryText}>Start</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={onDismiss}>
                <Text style={styles.secondaryText}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {guiding && step ? (
          <View style={styles.sheet} pointerEvents="auto">
            <Text style={styles.summary}>
              {formatSeconds(remainingDurationSeconds(fix ?? step.path[0] ?? guiding.destination, guiding.route, guiding.stepIndex))}
              {" · "}
              {formatMeters(remainingDistanceMeters(fix ?? step.path[0] ?? guiding.destination, guiding.route, guiding.stepIndex))}
              {" · "}
              {arrivalLabel(
                now,
                remainingDurationSeconds(fix ?? step.path[0] ?? guiding.destination, guiding.route, guiding.stepIndex),
              )}
            </Text>
            {guiding.rerouteMessage ? <Text style={styles.message}>{guiding.rerouteMessage}</Text> : null}
            <View style={styles.row}>
              <Pressable style={styles.primary} onPress={onDismiss}>
                <Text style={styles.primaryText}>End</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={onMute}>
                <Text style={styles.secondaryText}>{guiding.muted ? "Unmute" : "Mute"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {arrived ? (
          <View style={styles.sheet} pointerEvents="auto">
            <Pressable style={styles.primary} onPress={onDismiss}>
              <Text style={styles.primaryText}>End</Text>
            </Pressable>
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

function arrivalLabel(nowMs: number, remainingSeconds: number): string {
  return new Date(nowMs + remainingSeconds * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
  },
  searchCard: {
    margin: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#767676",
    borderRadius: 12,
    overflow: "hidden",
  },
  maneuverCard: {
    marginHorizontal: 12,
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
  },
  maneuver: {
    fontSize: 16,
    color: "#333",
  },
  maneuverDistance: {
    fontSize: 36,
    fontWeight: "700",
    marginTop: 4,
  },
  instruction: {
    fontSize: 18,
    marginTop: 4,
  },
  spacer: {
    flex: 1,
  },
  sheet: {
    margin: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
  },
  destination: {
    fontSize: 18,
  },
  summary: {
    fontSize: 20,
    marginTop: 6,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  primary: {
    flex: 1,
    backgroundColor: "#1A73E8",
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
    backgroundColor: "#eee",
  },
  secondaryText: {
    fontSize: 18,
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
  },
});
