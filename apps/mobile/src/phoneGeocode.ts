import type { GeoCoordinate } from "@groundops/contracts";
import * as Location from "expo-location";
import { Platform } from "react-native";

const resolved = new Map<string, GeoCoordinate>();

function cacheKey(contactId: string, addressId: string): string {
  return `${contactId}\n${addressId}`;
}

/** Remembers a coordinate resolved outside the device geocoder (for example Places). */
export function rememberPostalCoordinate(contactId: string, addressId: string, coordinate: GeoCoordinate): void {
  resolved.set(cacheKey(contactId, addressId), coordinate);
}

/** Resolves one phone address when the driver uses it. The result stays in memory for the session. */
export async function geocodePostal(
  contactId: string,
  addressId: string,
  postal: string,
): Promise<GeoCoordinate | "failed"> {
  const key = cacheKey(contactId, addressId);
  const cached = resolved.get(key);
  if (cached) {
    return cached;
  }
  if (Platform.OS === "web" || postal.trim().length === 0) {
    return "failed";
  }
  try {
    const current = await Location.getForegroundPermissionsAsync();
    const permission = current.granted ? current : await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      return "failed";
    }
    const results = await Location.geocodeAsync(postal);
    const first = results[0];
    if (!first || !Number.isFinite(first.latitude) || !Number.isFinite(first.longitude)) {
      return "failed";
    }
    const coordinate = { latitude: first.latitude, longitude: first.longitude };
    resolved.set(key, coordinate);
    return coordinate;
  } catch {
    return "failed";
  }
}
