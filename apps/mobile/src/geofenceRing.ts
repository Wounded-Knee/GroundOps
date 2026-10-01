import type { GeoCoordinate } from "@groundops/contracts";

const closeEpsilon = 1e-9;

export type GeofenceRingState = {
  vertices: GeoCoordinate[];
  selectedIndex: number | null;
};

export function emptyRingState(): GeofenceRingState {
  return { vertices: [], selectedIndex: null };
}

/** Drop a duplicated closing vertex when first ≈ last. */
export function normalizeRing(ring: GeoCoordinate[]): GeoCoordinate[] {
  if (ring.length < 2) {
    return ring.slice();
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) {
    return ring.slice();
  }
  if (sameCoordinate(first, last)) {
    return ring.slice(0, -1);
  }
  return ring.slice();
}

export function ringFromProps(ring: GeoCoordinate[]): GeofenceRingState {
  return { vertices: normalizeRing(ring), selectedIndex: null };
}

export function isValidRing(vertices: GeoCoordinate[]): boolean {
  return vertices.length >= 3;
}

/** Polygon coordinates for map display (closes the ring when ≥ 3 vertices). */
export function displayPolygonCoordinates(vertices: GeoCoordinate[]): GeoCoordinate[] {
  if (vertices.length < 3) {
    return [];
  }
  const first = vertices[0];
  if (!first) {
    return [];
  }
  return [...vertices, first];
}

export function addVertex(state: GeofenceRingState, point: GeoCoordinate): GeofenceRingState {
  return {
    vertices: [...state.vertices, point],
    selectedIndex: null,
  };
}

export function selectVertex(state: GeofenceRingState, index: number): GeofenceRingState {
  if (index < 0 || index >= state.vertices.length) {
    return state;
  }
  if (state.selectedIndex === index) {
    return { ...state, selectedIndex: null };
  }
  return { ...state, selectedIndex: index };
}

export function moveSelectedVertex(state: GeofenceRingState, point: GeoCoordinate): GeofenceRingState {
  if (state.selectedIndex === null) {
    return state;
  }
  const moved = setVertexAt(state, state.selectedIndex, point);
  return { ...moved, selectedIndex: null };
}

export function setVertexAt(
  state: GeofenceRingState,
  index: number,
  point: GeoCoordinate,
): GeofenceRingState {
  if (index < 0 || index >= state.vertices.length) {
    return state;
  }
  const vertices = state.vertices.slice();
  vertices[index] = point;
  return { vertices, selectedIndex: index };
}

export function deleteSelectedVertex(state: GeofenceRingState): GeofenceRingState {
  if (state.selectedIndex === null) {
    return state;
  }
  const index = state.selectedIndex;
  if (index < 0 || index >= state.vertices.length) {
    return { ...state, selectedIndex: null };
  }
  const vertices = state.vertices.filter((_, i) => i !== index);
  return { vertices, selectedIndex: null };
}

export function undoLastAdd(state: GeofenceRingState): GeofenceRingState {
  if (state.vertices.length === 0) {
    return state;
  }
  return {
    vertices: state.vertices.slice(0, -1),
    selectedIndex: null,
  };
}

export function clearRing(_state: GeofenceRingState): GeofenceRingState {
  return emptyRingState();
}

/** Apply a map tap: move selected vertex, otherwise append. */
export function applyMapTap(state: GeofenceRingState, point: GeoCoordinate): GeofenceRingState {
  if (state.selectedIndex !== null) {
    return moveSelectedVertex(state, point);
  }
  return addVertex(state, point);
}

export function cameraForRing(
  vertices: GeoCoordinate[],
  fallback: { latitude: number; longitude: number; zoom: number },
): { latitude: number; longitude: number; zoom: number } {
  if (vertices.length === 0) {
    return fallback;
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const vertex of vertices) {
    minLat = Math.min(minLat, vertex.latitude);
    maxLat = Math.max(maxLat, vertex.latitude);
    minLon = Math.min(minLon, vertex.longitude);
    maxLon = Math.max(maxLon, vertex.longitude);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    zoom: fallback.zoom,
  };
}

function sameCoordinate(a: GeoCoordinate, b: GeoCoordinate): boolean {
  return Math.abs(a.latitude - b.latitude) < closeEpsilon && Math.abs(a.longitude - b.longitude) < closeEpsilon;
}
