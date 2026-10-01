import type { GeoCoordinate } from "@groundops/contracts";

export type MapViewport = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type MapSize = {
  width: number;
  height: number;
};

export function geoToScreen(
  point: GeoCoordinate,
  viewport: MapViewport,
  size: MapSize,
): { x: number; y: number } {
  if (size.width <= 0 || size.height <= 0 || viewport.latitudeDelta === 0 || viewport.longitudeDelta === 0) {
    return { x: 0, y: 0 };
  }
  const left = viewport.longitude - viewport.longitudeDelta / 2;
  const top = viewport.latitude + viewport.latitudeDelta / 2;
  return {
    x: ((point.longitude - left) / viewport.longitudeDelta) * size.width,
    y: ((top - point.latitude) / viewport.latitudeDelta) * size.height,
  };
}

export function screenToGeo(
  screen: { x: number; y: number },
  viewport: MapViewport,
  size: MapSize,
): GeoCoordinate {
  if (size.width <= 0 || size.height <= 0 || viewport.latitudeDelta === 0 || viewport.longitudeDelta === 0) {
    return { latitude: viewport.latitude, longitude: viewport.longitude };
  }
  const left = viewport.longitude - viewport.longitudeDelta / 2;
  const top = viewport.latitude + viewport.latitudeDelta / 2;
  return {
    longitude: left + (screen.x / size.width) * viewport.longitudeDelta,
    latitude: top - (screen.y / size.height) * viewport.latitudeDelta,
  };
}

/** Approximate deltas for an initial camera before the first onCameraMove. */
export function viewportFromCamera(
  camera: { latitude: number; longitude: number; zoom: number },
): MapViewport {
  const longitudeDelta = 360 / 2 ** camera.zoom;
  const latitudeDelta = longitudeDelta;
  return {
    latitude: camera.latitude,
    longitude: camera.longitude,
    latitudeDelta,
    longitudeDelta,
  };
}
