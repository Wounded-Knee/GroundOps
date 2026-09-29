import { AppleMaps, GoogleMaps } from "expo-maps";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import type { GeoCoordinate } from "@groundops/contracts";

export type MapCamera = {
  latitude: number;
  longitude: number;
  zoom: number;
  bearing?: number;
  tilt?: number;
};

export type MapHandle = {
  setCamera: (camera: MapCamera) => void;
};

type PlatformMapProps = {
  path: GeoCoordinate[];
  destination: GeoCoordinate | null;
  user: GeoCoordinate | null;
  showTraffic: boolean;
  followUser: boolean;
};

const routeColor = "#1A73E8";

export const PlatformMap = forwardRef<MapHandle, PlatformMapProps>(function PlatformMap(
  { path, destination, user, showTraffic, followUser },
  ref,
) {
  const googleRef = useRef<GoogleMaps.MapView | null>(null);
  const appleRef = useRef<AppleMaps.MapView | null>(null);
  const mapReady = useRef(Platform.OS !== "android");
  const pendingCamera = useRef<MapCamera | null>(null);
  const [androidMapLoaded, setAndroidMapLoaded] = useState(false);

  function moveCamera(camera: MapCamera) {
    const position = {
      coordinates: { latitude: camera.latitude, longitude: camera.longitude },
      zoom: camera.zoom,
      ...(camera.bearing !== undefined ? { bearing: camera.bearing } : {}),
      ...(camera.tilt !== undefined ? { tilt: camera.tilt } : {}),
    };
    if (Platform.OS === "ios") {
      appleRef.current?.setCameraPosition(position);
      return;
    }
    // Shorter than the ~1s GPS cadence so heading corrections finish before the next fix.
    googleRef.current?.setCameraPosition({ ...position, duration: 350 });
  }

  useImperativeHandle(ref, () => ({
    setCamera(camera) {
      if (!mapReady.current) {
        pendingCamera.current = camera;
        return;
      }
      moveCamera(camera);
    },
  }));

  function handleMapLoaded() {
    mapReady.current = true;
    setAndroidMapLoaded(true);
    const camera = pendingCamera.current;
    pendingCamera.current = null;
    if (camera) {
      moveCamera(camera);
    }
  }

  const polylines =
    path.length > 0 ? [{ id: "route", coordinates: path, color: routeColor, width: 12 }] : [];
  const markers = destination
    ? [{ id: "destination", coordinates: destination, title: "Destination" }]
    : [];
  const properties = {
    isMyLocationEnabled: user !== null,
    isTrafficEnabled: showTraffic,
  };

  if (Platform.OS === "ios") {
    return (
      <AppleMaps.View
        ref={appleRef}
        style={styles.map}
        markers={markers}
        polylines={polylines}
        properties={properties}
        uiSettings={{ myLocationButtonEnabled: false, compassEnabled: true }}
      />
    );
  }

  return (
    <GoogleMaps.View
      ref={googleRef}
      onMapLoaded={handleMapLoaded}
      style={styles.map}
      markers={markers}
      polylines={polylines}
      properties={properties}
      uiSettings={{ myLocationButtonEnabled: false, compassEnabled: true, zoomControlsEnabled: false }}
      {...(user
        ? {
            userLocation: {
              coordinates: user,
              followUserLocation: androidMapLoaded && followUser,
            },
          }
        : {})}
    />
  );
});

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
