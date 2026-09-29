import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import { resolveApiUrl } from "./apiUrl";
import { reportLocationObservation } from "./calendarClient";
import { distanceMeters } from "./guidance";

const apiUrl = resolveApiUrl();
const moveMeters = 100;
const heartbeatMs = 5 * 60 * 1000;
const maxAccuracyMeters = 100;

type Fix = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  observedAt: string;
};

/** Reports foreground GPS fixes while the signed-in app is open. A track is not stored on the device. */
export function LocationReporter({
  token,
  onUnauthorized,
}: {
  token: string;
  onUnauthorized: () => void;
}) {
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const latest = { fix: null as Fix | null };
    const sent = { fix: null as { latitude: number; longitude: number; at: number } | null };

    async function send(fix: Fix): Promise<void> {
      const previous = sent.fix;
      const moved = !previous || distanceMeters(previous, fix) >= moveMeters;
      const due = !previous || Date.now() - previous.at >= heartbeatMs;
      if (!moved && !due) {
        return;
      }
      if (fix.accuracy !== null && fix.accuracy > maxAccuracyMeters) {
        return;
      }
      const result = await reportLocationObservation(apiUrl, tokenRef.current, {
        observedAt: fix.observedAt,
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyMeters: fix.accuracy,
      });
      if (cancelled) {
        return;
      }
      if (result === "unauthorized") {
        onUnauthorizedRef.current();
        return;
      }
      if (result === "ok") {
        sent.fix = { latitude: fix.latitude, longitude: fix.longitude, at: Date.now() };
      }
    }

    function remember(location: Location.LocationObject): void {
      const accuracy = location.coords.accuracy;
      latest.fix = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null,
        observedAt: new Date(location.timestamp).toISOString(),
      };
      void send(latest.fix);
    }

    async function start(): Promise<void> {
      const current = await Location.getForegroundPermissionsAsync();
      const next = current.status === "granted" ? current : await Location.requestForegroundPermissionsAsync();
      if (cancelled || next.status !== "granted") {
        return;
      }
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 25,
          timeInterval: 15_000,
        },
        remember,
      );
      if (cancelled) {
        subscription.remove();
        subscription = null;
      }
    }

    function stop(): void {
      subscription?.remove();
      subscription = null;
    }

    function sync(state: string): void {
      if (state === "active") {
        void start();
        return;
      }
      stop();
    }

    sync(AppState.currentState);
    const appState = AppState.addEventListener("change", sync);
    heartbeat = setInterval(() => {
      if (latest.fix && AppState.currentState === "active") {
        void send(latest.fix);
      }
    }, 30_000);

    return () => {
      cancelled = true;
      appState.remove();
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      stop();
    };
  }, [token]);

  return null;
}
