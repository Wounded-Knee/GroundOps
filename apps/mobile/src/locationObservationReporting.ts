import type { LocationObservationRequest } from "@groundops/contracts";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { reportLocationObservation } from "./calendarClient";
import { distanceMeters } from "./guidance";
import { readStoredSession } from "./sessionStore";

export const locationObservationTaskName = "groundops-location-observations";

const lastSentKey = "groundops.lastLocationObservation";
const moveMeters = 100;
const heartbeatMs = 5 * 60 * 1000;
const maxAccuracyMeters = 100;

type SentFix = {
  latitude: number;
  longitude: number;
  at: number;
};

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export async function reportEligibleLocationFix(
  location: Location.LocationObject,
): Promise<"ok" | "unauthorized" | "rejected" | "skipped"> {
  const accuracy = location.coords.accuracy;
  const fix: LocationObservationRequest = {
    observedAt: new Date(location.timestamp).toISOString(),
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracyMeters: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null,
  };
  if (fix.accuracyMeters !== null && fix.accuracyMeters > maxAccuracyMeters) {
    return "skipped";
  }

  const previous = await readLastSent();
  const moved = !previous || distanceMeters(previous, fix) >= moveMeters;
  const due = !previous || Date.now() - previous.at >= heartbeatMs;
  if (!moved && !due) {
    return "skipped";
  }

  const token = await readStoredSession();
  if (!token) {
    return "skipped";
  }

  const result = await reportLocationObservation(resolveApiUrl(), token, fix);
  if (result === "ok") {
    await writeLastSent({
      latitude: fix.latitude,
      longitude: fix.longitude,
      at: Date.now(),
    });
  }
  return result;
}

export async function startLocationObservationUpdates(): Promise<boolean> {
  if (Platform.OS === "web") {
    return false;
  }
  const available = await Location.isBackgroundLocationAvailableAsync();
  if (!available) {
    return false;
  }
  const started = await Location.hasStartedLocationUpdatesAsync(locationObservationTaskName);
  if (started) {
    return true;
  }
  await Location.startLocationUpdatesAsync(locationObservationTaskName, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 25,
    timeInterval: 15_000,
    deferredUpdatesDistance: moveMeters,
    deferredUpdatesInterval: heartbeatMs,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: "Groundops",
      notificationBody: "Sharing your location for schedule updates.",
    },
  });
  return true;
}

export async function stopLocationObservationUpdates(): Promise<void> {
  if (Platform.OS === "web") {
    return;
  }
  const started = await Location.hasStartedLocationUpdatesAsync(locationObservationTaskName);
  if (!started) {
    return;
  }
  await Location.stopLocationUpdatesAsync(locationObservationTaskName);
}

async function readLastSent(): Promise<SentFix | null> {
  const raw = await readRaw(lastSentKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SentFix>;
    if (
      typeof parsed.latitude !== "number" ||
      typeof parsed.longitude !== "number" ||
      typeof parsed.at !== "number"
    ) {
      return null;
    }
    return { latitude: parsed.latitude, longitude: parsed.longitude, at: parsed.at };
  } catch {
    return null;
  }
}

async function writeLastSent(fix: SentFix): Promise<void> {
  await writeRaw(lastSentKey, JSON.stringify(fix));
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return webStorage().getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    webStorage().setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

function webStorage(): WebStorage {
  const storage = (globalThis as { localStorage?: WebStorage }).localStorage;
  if (!storage) {
    throw new Error("Could not reach local storage.");
  }
  return storage;
}
