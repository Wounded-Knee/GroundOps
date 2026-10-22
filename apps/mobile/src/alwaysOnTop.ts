import { requireNativeModule } from "expo";
import { Platform } from "react-native";
import type { VisualAlertPrefs } from "./visualAlertPrefs";
import { alertEdges, edgeFadeStops, throbBrightness, throbIntensity, type AlertSide, type FadeStop } from "./visualAlertThrob";

export { floatingRouteScale, isActiveNavigation } from "./alwaysOnTopLogic";

type AlertFrame = {
  enabled: boolean;
  intensity: number;
  stops: FadeStop[];
};

type ThrobFrame = {
  count: number;
  intensity: number;
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
  stops: FadeStop[];
};

type AlwaysOnTopNative = {
  setEligible(eligible: boolean): void;
  dismiss(): void;
  isActive(): boolean;
  canDrawOverlays(): boolean;
  promptOverlayPermission(): void;
  setFloating(active: boolean): boolean;
  setAlert(frame: AlertFrame): boolean;
  throb(frame: ThrobFrame): boolean;
  clearAlert(): void;
  addListener(event: "change", listener: (event: { active?: boolean }) => void): { remove(): void };
};

let native: AlwaysOnTopNative | null | undefined;
let overlayActive = false;
let remembered: VisualAlertPrefs | null = null;
let overlayUnavailable: (() => void) | null = null;

function module(): AlwaysOnTopNative | null {
  if (Platform.OS !== "android") {
    return null;
  }
  if (native !== undefined) {
    return native;
  }
  try {
    native = requireNativeModule<AlwaysOnTopNative>("AlwaysOnTop");
  } catch {
    native = null;
  }
  return native ?? null;
}

export function setNativeOverlayActive(active: boolean): void {
  overlayActive = active;
}

export function isNativeOverlayActive(): boolean {
  return overlayActive;
}

/** The full-screen overlay could not attach. The in-app alert should show instead. */
export function subscribeOverlayUnavailable(listener: () => void): () => void {
  overlayUnavailable = listener;
  return () => {
    if (overlayUnavailable === listener) {
      overlayUnavailable = null;
    }
  };
}

function noteNativeOverlayFailed(): void {
  overlayActive = false;
  overlayUnavailable?.();
}

export function rememberAlertPrefs(prefs: VisualAlertPrefs): void {
  remembered = prefs;
}

export function setAlwaysOnTopEligible(eligible: boolean): void {
  module()?.setEligible(eligible);
}

export function dismissAlwaysOnTop(): void {
  module()?.dismiss();
}

export function isAlwaysOnTopActive(): boolean {
  return module()?.isActive() ?? false;
}

export function canDrawOverlays(): boolean {
  return module()?.canDrawOverlays() ?? false;
}

export function promptOverlayPermission(): void {
  module()?.promptOverlayPermission();
}

/** Shows the steady rim while the map is floating. False when the overlay cannot attach. */
export function armNativeAlert(prefs: VisualAlertPrefs): boolean {
  remembered = prefs;
  const current = module();
  if (!current) {
    return false;
  }
  const intensity = clamp01(prefs.intensity);
  const brightness = clamp01(prefs.brightness);
  const show = prefs.enabled && intensity > 0 && brightness > 0;
  current.setFloating(true);
  return current.setAlert({
    enabled: show,
    intensity: show ? intensity : 0,
    stops: show ? edgeFadeStops(prefs.color, brightness) : [],
  });
}

export function clearNativeAlert(): void {
  module()?.clearAlert();
}

export function playNativeThrob(count: number, side: AlertSide): boolean {
  const current = module();
  const prefs = remembered;
  if (!current || !prefs) {
    return false;
  }
  const stops = edgeFadeStops(prefs.color, throbBrightness);
  if (stops.length < 2) {
    return false;
  }
  const edges = alertEdges(side);
  const played = current.throb({
    count,
    intensity: throbIntensity,
    top: edges.top,
    bottom: edges.bottom,
    left: edges.left,
    right: edges.right,
    stops,
  });
  if (!played) {
    noteNativeOverlayFailed();
  }
  return played;
}

export function subscribeAlwaysOnTop(listener: (active: boolean) => void): () => void {
  const current = module();
  if (!current) {
    return () => undefined;
  }
  const subscription = current.addListener("change", (event) => {
    listener(event.active === true);
  });
  return () => {
    subscription.remove();
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
