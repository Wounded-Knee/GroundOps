import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";
import {
  locationObservationTaskName,
  reportEligibleLocationFix,
  startLocationObservationUpdates,
  stopLocationObservationUpdates,
} from "./locationObservationReporting";

/** Reports GPS fixes while signed in, including when the app is backgrounded on iOS and Android. */
export function LocationReporter({
  token,
  onUnauthorized,
}: {
  token: string;
  onUnauthorized: () => void;
}) {
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    async function send(location: Location.LocationObject): Promise<void> {
      const result = await reportEligibleLocationFix(location);
      if (cancelled) {
        return;
      }
      if (result === "unauthorized") {
        onUnauthorizedRef.current();
      }
    }

    async function startNativeBackground(): Promise<void> {
      const foreground = await Location.getForegroundPermissionsAsync();
      const grantedForeground =
        foreground.status === "granted"
          ? foreground
          : await Location.requestForegroundPermissionsAsync();
      if (cancelled || grantedForeground.status !== "granted") {
        return;
      }

      const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
      if (background && background.status !== "granted") {
        await Location.requestBackgroundPermissionsAsync().catch(() => null);
      }
      if (cancelled) {
        return;
      }

      try {
        await startLocationObservationUpdates();
      } catch {
        // Fall through to foreground watch when background registration fails.
      }
      if (cancelled) {
        return;
      }

      const usingBackground = await Location.hasStartedLocationUpdatesAsync(locationObservationTaskName);
      if (usingBackground || cancelled) {
        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 25,
          timeInterval: 15_000,
        },
        (location) => {
          void send(location);
        },
      );
      if (cancelled) {
        subscription.remove();
        subscription = null;
      }
    }

    async function startWeb(): Promise<void> {
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
        (location) => {
          void send(location);
        },
      );
      if (cancelled) {
        subscription.remove();
        subscription = null;
      }
    }

    if (Platform.OS === "web") {
      void startWeb();
    } else {
      void startNativeBackground();
    }

    return () => {
      cancelled = true;
      subscription?.remove();
      void stopLocationObservationUpdates();
    };
  }, [token]);

  return null;
}
