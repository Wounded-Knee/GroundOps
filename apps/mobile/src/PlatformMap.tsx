import type { GeoCoordinate } from "@groundops/contracts";
import { AppleMaps, GoogleMaps, type CameraMoveEvent } from "expo-maps";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { PixelRatio, Platform, StyleSheet } from "react-native";
import { guidanceZoom } from "./guidance";
import { routeStrokeScale } from "./mapProjection";

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

export type MapCameraMove = {
  latitude: number;
  longitude: number;
  zoom: number;
  tilt: number;
  bearing: number;
};

type PlatformMapProps = {
  path: GeoCoordinate[];
  destination: GeoCoordinate | null;
  user: GeoCoordinate | null;
  showTraffic: boolean;
  followUser: boolean;
  /** Zoom at which the route keeps its design thickness. */
  navigationZoom?: number;
  /** Multiplier on the route stroke. The floating window uses a thinner line. */
  routeScale?: number;
  /** Map artwork only: no toolbar, compass, scale, or marker callout. */
  bare?: boolean;
  onCameraMove?: (camera: MapCameraMove) => void;
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
  { path, destination, user, showTraffic, followUser, navigationZoom = guidanceZoom, routeScale = 1, bare = false, onCameraMove },
  ref,
) {
  const googleRef = useRef<GoogleMaps.MapView | null>(null);
  const appleRef = useRef<AppleMaps.MapView | null>(null);
  const mapReady = useRef(Platform.OS !== "android");
  const pendingCamera = useRef<MapCamera | null>(null);
  const [androidMapLoaded, setAndroidMapLoaded] = useState(false);
  const [displayedUser, setDisplayedUserState] = useState<GeoCoordinate | null>(null);
  const [zoom, setZoom] = useState(navigationZoom);

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

  const strokeScale = routeStrokeScale(zoom, navigationZoom);
  const polylines = useMemo(
    () =>
      path.length > 0
        ? [
            {
              id: "route-casing",
              coordinates: path,
              color: routeCasingColor,
              width: routeStrokeWidth(Math.max(1, routeCasingWidthDp * strokeScale * routeScale)),
            },
            {
              id: "route",
              coordinates: path,
              color: routeColor,
              width: routeStrokeWidth(Math.max(1, routeWidthDp * strokeScale * routeScale)),
            },
          ]
        : [],
    [path, strokeScale, routeScale],
  );
  const markers = destination
    ? [{ id: "destination", coordinates: destination, ...(bare ? {} : { title: "Destination" }) }]
    : [];
  const hasUser = user !== null;
  const properties = useMemo(
    () => ({
      // Android draws its own yellow puck from userLocation. iOS keeps the system dot.
      isMyLocationEnabled: Platform.OS === "ios" && hasUser,
      isTrafficEnabled: showTraffic,
      selectionEnabled: !bare,
    }),
    [hasUser, showTraffic, bare],
  );

  function handleCameraMove(event: CameraMoveEvent) {
    setZoom((current) => (Math.abs(current - event.zoom) < 0.01 ? current : event.zoom));
    const latitude = event.coordinates.latitude;
    const longitude = event.coordinates.longitude;
    if (latitude === undefined || longitude === undefined) {
      return;
    }
    onCameraMove?.({
      latitude,
      longitude,
      zoom: event.zoom,
      tilt: event.tilt,
      bearing: event.bearing,
    });
  }
  const puck = displayedUser ?? user;

  if (Platform.OS === "ios") {
    return (
      <AppleMaps.View
        ref={appleRef}
        style={styles.map}
        markers={markers}
        polylines={polylines}
        properties={properties}
        onCameraMove={handleCameraMove}
        uiSettings={{
          myLocationButtonEnabled: false,
          compassEnabled: false,
          scaleBarEnabled: !bare,
          togglePitchEnabled: !bare,
        }}
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
      onCameraMove={handleCameraMove}
      uiSettings={{
        myLocationButtonEnabled: false,
        compassEnabled: false,
        zoomControlsEnabled: false,
        mapToolbarEnabled: !bare,
        indoorLevelPickerEnabled: !bare,
        scaleBarEnabled: !bare,
      }}
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
