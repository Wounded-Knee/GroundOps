import type { GeoCoordinate } from "@groundops/contracts";
import * as Location from "expo-location";
import { AppleMaps, GoogleMaps } from "expo-maps";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native";
import {
  applyMapTap,
  clearRing,
  deleteSelectedVertex,
  displayPolygonCoordinates,
  isValidRing,
  ringFromProps,
  setVertexAt,
  undoLastAdd,
  type GeofenceRingState,
} from "./geofenceRing";
import {
  geoToScreen,
  screenToGeo,
  viewportFromCamera,
  type MapSize,
  type MapViewport,
} from "./mapProjection";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";

const fallbackCamera = { latitude: 40.758, longitude: -73.9855, zoom: 15 };
const fenceFill = "#1A73E866";
const fenceStroke = "#1A73E8";
const dotSize = 16;
const hitSize = 44;

export type GeofenceCamera = {
  latitude: number;
  longitude: number;
  zoom: number;
};

export function GeofenceEditor({
  ring,
  initialCamera,
  onSave,
  onCancel,
}: {
  ring: GeoCoordinate[];
  initialCamera?: GeofenceCamera;
  onSave: (ring: GeoCoordinate[] | "invalid") => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const seeded = ringFromProps(ring);
  const [state, setState] = useState<GeofenceRingState>(() => seeded);
  const [mapSize, setMapSize] = useState<MapSize>({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<MapViewport | null>(() =>
    initialCamera
      ? viewportFromCamera(initialCamera)
      : seeded.vertices.length > 0
        ? viewportFromCamera(cameraForVertices(seeded.vertices, fallbackCamera))
        : null,
  );
  const [dragging, setDragging] = useState(false);
  const googleRef = useRef<GoogleMaps.MapView | null>(null);
  const appleRef = useRef<AppleMaps.MapView | null>(null);
  const mapReady = useRef(Platform.OS !== "android");
  const pendingCamera = useRef<GeofenceCamera | null>(null);
  const viewportRef = useRef(viewport);
  const mapSizeRef = useRef(mapSize);
  viewportRef.current = viewport;
  mapSizeRef.current = mapSize;

  useEffect(() => {
    let cancelled = false;
    async function center(): Promise<void> {
      const camera = await resolveInitialCamera(ring, initialCamera);
      if (cancelled) {
        return;
      }
      setViewport(viewportFromCamera(camera));
      applyCamera(camera);
    }
    void center();
    return () => {
      cancelled = true;
    };
    // Center once when the editor mounts for this ring.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only camera seed
  }, []);

  function applyCamera(camera: GeofenceCamera): void {
    const position = {
      coordinates: { latitude: camera.latitude, longitude: camera.longitude },
      zoom: camera.zoom,
    };
    if (!mapReady.current) {
      pendingCamera.current = camera;
      return;
    }
    if (Platform.OS === "ios") {
      appleRef.current?.setCameraPosition(position);
      return;
    }
    googleRef.current?.setCameraPosition({ ...position, duration: 1 });
  }

  function handleMapLoaded(): void {
    mapReady.current = true;
    const camera = pendingCamera.current;
    pendingCamera.current = null;
    if (camera) {
      applyCamera(camera);
    }
  }

  function onLayout(event: LayoutChangeEvent): void {
    const { width, height } = event.nativeEvent.layout;
    setMapSize({ width, height });
  }

  function onCameraMove(event: {
    coordinates: { latitude?: number; longitude?: number };
    latitudeDelta: number;
    longitudeDelta: number;
  }): void {
    if (dragging) {
      return;
    }
    const { latitude, longitude } = event.coordinates;
    if (latitude === undefined || longitude === undefined) {
      return;
    }
    if (event.latitudeDelta <= 0 || event.longitudeDelta <= 0) {
      return;
    }
    setViewport({
      latitude,
      longitude,
      latitudeDelta: event.latitudeDelta,
      longitudeDelta: event.longitudeDelta,
    });
  }

  function onMapClick(event: { coordinates: { latitude?: number; longitude?: number } }): void {
    if (dragging) {
      return;
    }
    const { latitude, longitude } = event.coordinates;
    if (latitude === undefined || longitude === undefined) {
      return;
    }
    setState((current) => applyMapTap(current, { latitude, longitude }));
  }

  function save(): void {
    if (!isValidRing(state.vertices)) {
      onSave("invalid");
      return;
    }
    onSave(state.vertices);
  }

  const polygonCoords = displayPolygonCoordinates(state.vertices);
  const polygons =
    polygonCoords.length > 0
      ? [
          {
            id: "fence",
            coordinates: polygonCoords,
            color: fenceFill,
            lineColor: fenceStroke,
            lineWidth: 3,
          },
        ]
      : [];

  const canSave = isValidRing(state.vertices);
  const hint = dragging
    ? "Release to place the point."
    : state.selectedIndex !== null
      ? "Drag the selected point, or tap Delete."
      : "Tap the map to add a point. Drag a point to move it.";

  const map =
    Platform.OS === "ios" ? (
      <AppleMaps.View
        ref={appleRef}
        style={styles.map}
        polygons={polygons}
        onMapClick={onMapClick}
        onCameraMove={onCameraMove}
        uiSettings={{ myLocationButtonEnabled: false, compassEnabled: true, togglePitchEnabled: false }}
        properties={{ selectionEnabled: false, isMyLocationEnabled: true }}
      />
    ) : (
      <GoogleMaps.View
        ref={googleRef}
        style={styles.map}
        polygons={polygons}
        onMapLoaded={handleMapLoaded}
        onMapClick={onMapClick}
        onCameraMove={onCameraMove}
        uiSettings={{
          myLocationButtonEnabled: false,
          compassEnabled: true,
          zoomControlsEnabled: false,
          scrollGesturesEnabled: !dragging,
          rotationGesturesEnabled: false,
          tiltGesturesEnabled: false,
        }}
        properties={{ selectionEnabled: false, isMyLocationEnabled: true }}
      />
    );

  return (
    <View style={styles.screen} onLayout={onLayout}>
      {map}
      {viewport && mapSize.width > 0
        ? state.vertices.map((vertex, index) => (
            <VertexDot
              key={`v-${index}`}
              index={index}
              point={vertex}
              selected={state.selectedIndex === index}
              viewport={viewport}
              mapSize={mapSize}
              styles={styles}
              onDragStart={() => {
                setDragging(true);
                setState((current) => ({ ...current, selectedIndex: index }));
              }}
              onDragMove={(screenPoint) => {
                const vp = viewportRef.current;
                const size = mapSizeRef.current;
                if (!vp) {
                  return;
                }
                const geo = screenToGeo(screenPoint, vp, size);
                setState((current) => setVertexAt(current, index, geo));
              }}
              onDragEnd={() => setDragging(false)}
            />
          ))
        : null}
      <View style={styles.chrome} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable style={styles.button} onPress={onCancel}>
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.save, !canSave ? styles.disabled : null]}
            disabled={!canSave}
            onPress={save}
          >
            <Text style={styles.saveText}>Save</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>{hint}</Text>
        <View style={styles.tools}>
          <Pressable
            style={[styles.tool, state.vertices.length === 0 ? styles.disabled : null]}
            disabled={state.vertices.length === 0}
            onPress={() => setState((current) => undoLastAdd(current))}
          >
            <Text style={styles.toolText}>Undo</Text>
          </Pressable>
          <Pressable
            style={[styles.tool, state.selectedIndex === null ? styles.disabled : null]}
            disabled={state.selectedIndex === null}
            onPress={() => setState((current) => deleteSelectedVertex(current))}
          >
            <Text style={styles.toolText}>Delete</Text>
          </Pressable>
          <Pressable
            style={[styles.tool, state.vertices.length === 0 ? styles.disabled : null]}
            disabled={state.vertices.length === 0}
            onPress={() => setState((current) => clearRing(current))}
          >
            <Text style={styles.toolText}>Clear</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function VertexDot({
  index,
  point,
  selected,
  viewport,
  mapSize,
  styles,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  index: number;
  point: GeoCoordinate;
  selected: boolean;
  viewport: MapViewport;
  mapSize: MapSize;
  styles: ReturnType<typeof createStyles>;
  onDragStart: () => void;
  onDragMove: (screen: { x: number; y: number }) => void;
  onDragEnd: () => void;
}) {
  const screen = geoToScreen(point, viewport, mapSize);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const originRef = useRef(screen);
  const callbacksRef = useRef({ onDragStart, onDragMove, onDragEnd });
  callbacksRef.current = { onDragStart, onDragMove, onDragEnd };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          originRef.current = { ...screenRef.current };
          callbacksRef.current.onDragStart();
        },
        onPanResponderMove: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
          callbacksRef.current.onDragMove({
            x: originRef.current.x + gesture.dx,
            y: originRef.current.y + gesture.dy,
          });
        },
        onPanResponderRelease: () => {
          callbacksRef.current.onDragEnd();
        },
        onPanResponderTerminate: () => {
          callbacksRef.current.onDragEnd();
        },
      }),
    [],
  );

  return (
    <View
      {...pan.panHandlers}
      style={[
        styles.hit,
        {
          left: screen.x - hitSize / 2,
          top: screen.y - hitSize / 2,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Geofence vertex ${index + 1}`}
    >
      <View style={styles.hitInner}>
        <View style={[styles.dot, selected ? styles.dotSelected : null]} />
      </View>
    </View>
  );
}

function cameraForVertices(vertices: GeoCoordinate[], fallback: GeofenceCamera): GeofenceCamera {
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

async function resolveInitialCamera(
  ring: GeoCoordinate[],
  initialCamera: GeofenceCamera | undefined,
): Promise<GeofenceCamera> {
  if (initialCamera) {
    return initialCamera;
  }
  const vertices = ringFromProps(ring).vertices;
  if (vertices.length > 0) {
    return cameraForVertices(vertices, fallbackCamera);
  }
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status === "granted") {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        zoom: fallbackCamera.zoom,
      };
    }
  } catch {
    // Fall through to default.
  }
  return fallbackCamera;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    map: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    chrome: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      justifyContent: "space-between",
      padding: 12,
    },
    topBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
    },
    hint: {
      alignSelf: "center",
      backgroundColor: colors.surface,
      color: colors.textSecondary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      overflow: "hidden",
      fontSize: 13,
      maxWidth: "90%",
      textAlign: "center",
    },
    tools: {
      flexDirection: "row",
      gap: 8,
      justifyContent: "center",
      marginBottom: 8,
    },
    button: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 8,
    },
    save: {
      backgroundColor: colors.accent,
    },
    disabled: {
      opacity: 0.45,
    },
    buttonText: {
      color: colors.primaryText,
      fontSize: 16,
    },
    saveText: {
      color: "#fff",
      fontSize: 16,
    },
    tool: {
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    toolText: {
      color: colors.text,
      fontSize: 14,
    },
    hit: {
      position: "absolute",
      width: hitSize,
      height: hitSize,
      zIndex: 2,
    },
    hitInner: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    dot: {
      width: dotSize,
      height: dotSize,
      borderRadius: dotSize / 2,
      backgroundColor: fenceStroke,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    dotSelected: {
      backgroundColor: colors.accent,
    },
  });
}
