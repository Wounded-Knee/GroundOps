import { AppleMaps, GoogleMaps } from "expo-maps";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { PixelRatio, Platform, StyleSheet } from "react-native";
import type { GeoCoordinate } from "@groundops/contracts";

export type MapCamera = {
  latitude: number;
  longitude: number;
  zoom: number;
  bearing?: number;
  tilt?: number;
  /**
   * Animation length in milliseconds.
   * 0 applies the pose immediately. Omit it for a one-shot animated move.
   */
  duration?: number;
};

export type MapHandle = {
  setCamera: (camera: MapCamera) => void;
  /** Android location dot. Null falls back to the raw user fix. Ignored on iOS. */
  setDisplayedUser: (coordinate: GeoCoordinate | null) => void;
};

type PlatformMapProps = {
  path: GeoCoordinate[];
  destination: GeoCoordinate | null;
  user: GeoCoordinate | null;
  showTraffic: boolean;
  followUser: boolean;
};

const routeColor = "#1A73E8";
const routeCasingColor = "#174EA6";
/** Density-independent route stroke. Android Maps treats width as raw pixels. */
const routeWidthDp = 22;
const routeCasingWidthDp = 30;

function routeStrokeWidth(dp: number): number {
  return Platform.OS === "android" ? PixelRatio.getPixelSizeForLayoutSize(dp) : dp;
}

export const PlatformMap = forwardRef<MapHandle, PlatformMapProps>(function PlatformMap(
  { path, destination, user, showTraffic, followUser },
  ref,
) {
  const googleRef = useRef<GoogleMaps.MapView | null>(null);
  const appleRef = useRef<AppleMaps.MapView | null>(null);
  const mapReady = useRef(Platform.OS !== "android");
  const pendingCamera = useRef<MapCamera | null>(null);
  const [androidMapLoaded, setAndroidMapLoaded] = useState(false);
  const [displayedUser, setDisplayedUserState] = useState<GeoCoordinate | null>(null);

  function moveCamera(camera: MapCamera) {
    const position = {
      coordinates: { latitude: camera.latitude, longitude: camera.longitude },
      zoom: camera.zoom,
      ...(camera.bearing !== undefined ? { bearing: camera.bearing } : {}),
      ...(camera.tilt !== undefined ? { tilt: camera.tilt } : {}),
      ...(camera.duration !== undefined ? { duration: camera.duration } : {}),
    };
    if (Platform.OS === "ios") {
      appleRef.current?.setCameraPosition(position);
      return;
    }
    // One-shot moves (browse centering) keep a short animation. Guidance passes 0
    // because the JS loop already eases the pose.
    googleRef.current?.setCameraPosition({
      ...position,
      duration: camera.duration !== undefined ? camera.duration : 350,
    });
  }

  useImperativeHandle(ref, () => ({
    setCamera(camera) {
      if (!mapReady.current) {
        pendingCamera.current = camera;
        return;
      }
      moveCamera(camera);
    },
    setDisplayedUser(coordinate) {
      if (Platform.OS !== "android") {
        return;
      }
      setDisplayedUserState((current) => {
        if (current === coordinate) {
          return current;
        }
        if (
          current &&
          coordinate &&
          current.latitude === coordinate.latitude &&
          current.longitude === coordinate.longitude
        ) {
          return current;
        }
        return coordinate;
      });
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

  const polylines = useMemo(
    () =>
      path.length > 0
        ? [
            {
              id: "route-casing",
              coordinates: path,
              color: routeCasingColor,
              width: routeStrokeWidth(routeCasingWidthDp),
            },
            { id: "route", coordinates: path, color: routeColor, width: routeStrokeWidth(routeWidthDp) },
          ]
        : [],
    [path],
  );
  const markers = destination
    ? [{ id: "destination", coordinates: destination, title: "Destination" }]
    : [];
  const hasUser = user !== null;
  const properties = useMemo(
    () => ({
      isMyLocationEnabled: hasUser,
      isTrafficEnabled: showTraffic,
    }),
    [hasUser, showTraffic],
  );
  const puck = displayedUser ?? user;

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
      {...(puck
        ? {
            userLocation: {
              coordinates: puck,
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
