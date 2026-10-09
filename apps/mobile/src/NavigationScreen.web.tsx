import type { GeoCoordinate, Sortie, SortieStop, User } from "@groundops/contracts";
import Constants from "expo-constants";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MeterDisplay } from "./MeterStrip";
import type { SortieGuideCommand } from "./sortieGuide";
import { useTheme } from "./ThemeProvider";
import { formatMiles, formatMoney, formatWaitMinutes } from "./meter";
import { overviewFitPoints, overviewFrameKey, type AccountActivity } from "./liveActivity";
import { withAlpha, type ThemeColors } from "./theme";

export type { SortieGuideCommand } from "./sortieGuide";

type LatLng = { lat: number; lng: number };

type GoogleMap = {
  fitBounds: (bounds: GoogleBounds, padding?: number) => void;
  setCenter: (position: LatLng) => void;
  setZoom: (zoom: number) => void;
  setTilt: (tilt: number) => void;
  setHeading: (heading: number) => void;
  getTilt?: () => number;
  getHeading?: () => number;
  addListener: (event: string, handler: () => void) => void;
};

type GoogleMarker = {
  setPosition: (position: LatLng) => void;
  setMap: (map: GoogleMap | null) => void;
};

type GooglePolyline = {
  setPath: (path: LatLng[]) => void;
  setMap: (map: GoogleMap | null) => void;
};

type GoogleBounds = {
  extend: (position: LatLng) => void;
};

type GoogleNamespace = {
  maps: {
    Map: new (element: object, options: object) => GoogleMap;
    Marker: new (options: object) => GoogleMarker;
    Polyline: new (options: object) => GooglePolyline;
    LatLngBounds: new () => GoogleBounds;
  };
};

const routeColor = "#1A73E8";

export function NavigationScreen({
  accountView = null,
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
  accountView?: {
    user: User;
    live: "authenticated" | "closed";
    activity: AccountActivity;
  } | null;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const activity = accountView?.activity;
  const location = activity?.location ?? null;
  const sortie = activity?.sortie ?? null;
  const meter = activity?.meter ?? null;
  const vehicle = location ? { latitude: location.latitude, longitude: location.longitude } : null;
  const stops = sortie?.stops ?? [];
  const path = meter?.overviewPath ?? [];
  const mapsKey = webMapsKey();

  return (
    <View style={styles.screen}>
      {mapsKey ? (
        <OverviewMap
          mapsKey={mapsKey}
          path={path}
          stops={stops}
          vehicle={vehicle}
        />
      ) : (
        <View style={styles.mapFallback}>
          <Text style={styles.fallbackText}>Map unavailable</Text>
        </View>
      )}
      <View style={styles.card} pointerEvents="none">
        <Text style={styles.title}>{accountView ? identityLabel(accountView.user) : "Signed in"}</Text>
        <Text style={styles.line}>
          {accountView?.live === "authenticated"
            ? "Live connection authenticated"
            : "Live connection not authenticated"}
        </Text>
        <Text style={styles.line}>
          {location
            ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} at ${formatWhen(location.observedAt)}`
            : "No location yet"}
        </Text>
        {sortie ? (
          <>
            <Text style={styles.heading}>{sortie.label || sortie.stops[0]?.label || "Sortie"}</Text>
            {stops.map((stop, index) => (
              <Text key={`${stop.label}-${index}`} style={styles.line}>
                {index + 1}. {stop.label}
                {stop.actualArrivedAt ? ` arrived ${formatWhen(stop.actualArrivedAt)}` : ""}
                {stop.actualDepartedAt ? ` departed ${formatWhen(stop.actualDepartedAt)}` : ""}
              </Text>
            ))}
            <Text style={styles.line}>
              {meter
                ? `Fare ${formatMoney(meter.totalCents)} · ${formatMiles(meter.milesTraveled)} mi · ${formatWaitMinutes(meter.waitSeconds)} min wait`
                : "Fare not reported yet"}
            </Text>
          </>
        ) : (
          <Text style={styles.heading}>No sortie in progress</Text>
        )}
      </View>
    </View>
  );
}

function OverviewMap({
  mapsKey,
  path,
  stops,
  vehicle,
}: {
  mapsKey: string;
  path: GeoCoordinate[];
  stops: SortieStop[];
  vehicle: GeoCoordinate | null;
}) {
  const hostRef = useRef<object | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const mapRef = useRef<GoogleMap | null>(null);
  const vehicleMarkerRef = useRef<GoogleMarker | null>(null);
  const stopMarkersRef = useRef<GoogleMarker[]>([]);
  const lineRef = useRef<GooglePolyline | null>(null);
  const frameKeyRef = useRef("");
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const frameKey = overviewFrameKey(
    path,
    stops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })),
    vehicle !== null,
  );

  useEffect(() => {
    const host = hostRef.current;
    const google = mapsNamespace();
    if (!hostReady || !mapsReady || !host || !google) {
      return;
    }
    const map = mapRef.current ?? mountMap(google, host);
    mapRef.current = map;
    map.setTilt(0);
    map.setHeading(0);

    if (frameKey !== frameKeyRef.current) {
      frameKeyRef.current = frameKey;
      const pathPoints = path.map(toLatLng);
      if (!lineRef.current) {
        lineRef.current = new google.maps.Polyline({
          map,
          path: pathPoints,
          strokeColor: routeColor,
          strokeWeight: 5,
          clickable: false,
        });
      } else {
        lineRef.current.setPath(pathPoints);
      }
      for (const marker of stopMarkersRef.current) {
        marker.setMap(null);
      }
      stopMarkersRef.current = stops.map(
        (stop, index) =>
          new google.maps.Marker({
            map,
            position: toLatLng(stop),
            title: `${index + 1}. ${stop.label}`,
            label: String(index + 1),
          }),
      );
      fitOverview(google, map, overviewFitPoints(path, stops, vehicle));
    }

    if (vehicle) {
      const position = toLatLng(vehicle);
      if (!vehicleMarkerRef.current) {
        vehicleMarkerRef.current = new google.maps.Marker({
          map,
          position,
          title: "Vehicle",
          zIndex: 2,
        });
      } else {
        vehicleMarkerRef.current.setPosition(position);
      }
    } else if (vehicleMarkerRef.current) {
      vehicleMarkerRef.current.setMap(null);
      vehicleMarkerRef.current = null;
    }
  }, [frameKey, hostReady, mapsReady, vehicle?.latitude, vehicle?.longitude]);

  useEffect(() => {
    const document = (globalThis as { document?: { getElementById: (id: string) => object | null } }).document;
    const element = document?.getElementById("groundops-overview-map") ?? null;
    if (!element) {
      return;
    }
    hostRef.current = element;
    setHostReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps(mapsKey).then((google) => {
      if (cancelled || !google) {
        return;
      }
      setMapsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mapsKey]);

  return <View nativeID="groundops-overview-map" style={styles.map} />;
}

function mountMap(google: GoogleNamespace, element: object): GoogleMap {
  const map = new google.maps.Map(element, {
    center: { lat: 39.8, lng: -98.6 },
    zoom: 4,
    tilt: 0,
    heading: 0,
    mapTypeId: "roadmap",
    gestureHandling: "greedy",
    keyboardShortcuts: false,
    rotateControl: false,
    mapTypeControl: false,
    streetViewControl: false,
  });
  map.setTilt(0);
  map.setHeading(0);
  map.addListener("tilt_changed", () => {
    if ((map.getTilt?.() ?? 0) !== 0) {
      map.setTilt(0);
    }
  });
  map.addListener("heading_changed", () => {
    if ((map.getHeading?.() ?? 0) !== 0) {
      map.setHeading(0);
    }
  });
  return map;
}

function fitOverview(google: GoogleNamespace, map: GoogleMap, points: GeoCoordinate[]): void {
  if (points.length === 0) {
    return;
  }
  if (points.length === 1) {
    const only = points[0]!;
    map.setCenter(toLatLng(only));
    map.setZoom(14);
    map.setTilt(0);
    map.setHeading(0);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  for (const point of points) {
    bounds.extend(toLatLng(point));
  }
  map.fitBounds(bounds, 48);
  map.setTilt(0);
  map.setHeading(0);
}

function toLatLng(point: GeoCoordinate): LatLng {
  return { lat: point.latitude, lng: point.longitude };
}

function webMapsKey(): string {
  const fromEnv = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY?.trim() ?? "";
  if (fromEnv) {
    return fromEnv;
  }
  const extra = Constants.expoConfig?.extra as { googleMapsWebApiKey?: string } | undefined;
  return extra?.googleMapsWebApiKey?.trim() ?? "";
}

function mapsNamespace(): GoogleNamespace | null {
  const google = (globalThis as { google?: GoogleNamespace }).google;
  return google?.maps ? google : null;
}

function loadGoogleMaps(key: string): Promise<GoogleNamespace | null> {
  const existing = mapsNamespace();
  if (existing) {
    return Promise.resolve(existing);
  }
  const document = (globalThis as { document?: PageDocument }).document;
  if (!document) {
    return Promise.resolve(null);
  }
  const prior = document.querySelector("script[data-groundops-maps]");
  if (prior) {
    return new Promise((resolve) => {
      prior.addEventListener("load", () => resolve(mapsNamespace()));
      prior.addEventListener("error", () => resolve(null));
    });
  }
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.async = true;
    script.dataset.groundopsMaps = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
    script.onload = () => resolve(mapsNamespace());
    script.onerror = () => resolve(null);
    document.head?.appendChild(script);
  });
}

type PageDocument = {
  head: { appendChild: (node: PageScript) => void } | null;
  querySelector: (selector: string) => PageScript | null;
  createElement: (tag: string) => PageScript;
};

type PageScript = {
  async: boolean;
  src: string;
  dataset: { groundopsMaps?: string };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener: (event: string, listener: () => void) => void;
};

function identityLabel(user: User): string {
  if (user.displayName && user.email) {
    return `${user.displayName} (${user.email})`;
  }
  return user.displayName ?? user.email ?? "Signed in";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    map: {
      flex: 1,
    },
    mapFallback: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    fallbackText: {
      color: colors.textMuted,
      fontSize: 16,
    },
    card: {
      position: "absolute",
      top: 16,
      left: 16,
      right: 16,
      backgroundColor: withAlpha(colors.surface, 0.94),
      borderRadius: 12,
      padding: 12,
      gap: 4,
    },
    title: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "600",
    },
    heading: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "600",
      marginTop: 6,
    },
    line: {
      color: colors.textSecondary,
      fontSize: 14,
    },
  });
}
