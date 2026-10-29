import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  armNativeAlert,
  canDrawOverlays,
  clearNativeAlert,
  dismissAlwaysOnTop,
  isAlwaysOnTopActive,
  promptOverlayPermission,
  rememberAlertPrefs,
  setAlwaysOnTopEligible,
  setNativeOverlayActive,
  subscribeAlwaysOnTop,
} from "./alwaysOnTop";
import { ensureAlwaysOnTopConsentLoaded, rememberAlwaysOnTopConsentAsked } from "./alwaysOnTopConsent";
import { shouldAskAlwaysOnTopConsent } from "./alwaysOnTopLogic";
import {
  ensureVisualAlertPrefsLoaded,
  getVisualAlertPrefs,
  subscribeVisualAlertPrefs,
  type VisualAlertPrefs,
} from "./visualAlertPrefs";

export function useAlwaysOnTop(sessionStatus: string): {
  visualAlert: VisualAlertPrefs;
  floating: boolean;
  overlayGranted: boolean;
  overlayReady: boolean;
  onActiveNavigationChange: (active: boolean) => void;
} {
  const [visualAlert, setVisualAlert] = useState<VisualAlertPrefs>(getVisualAlertPrefs);
  const [navigationActive, setNavigationActive] = useState(false);
  const [floating, setFloating] = useState(false);
  const [overlayGranted, setOverlayGranted] = useState(false);
  const [overlayChecked, setOverlayChecked] = useState(false);
  const [overlayReady, setOverlayReady] = useState(false);
  const [consentAsked, setConsentAsked] = useState(false);
  const [consentReady, setConsentReady] = useState(false);
  const askedConsent = useRef(false);
  const promptingConsent = useRef(false);
  const floatingRef = useRef(false);
  const navigationActiveRef = useRef(false);
  floatingRef.current = floating;
  navigationActiveRef.current = navigationActive;

  const onActiveNavigationChange = useCallback((active: boolean) => {
    setNavigationActive(active);
  }, []);

  useEffect(() => {
    void ensureVisualAlertPrefsLoaded();
    return subscribeVisualAlertPrefs(() => {
      setVisualAlert(getVisualAlertPrefs());
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    setOverlayGranted(canDrawOverlays());
    setOverlayChecked(true);
    setFloating(isAlwaysOnTopActive());
    void ensureAlwaysOnTopConsentLoaded().then((asked) => {
      setConsentAsked(asked);
      setConsentReady(true);
    });
    const appState = AppState.addEventListener("change", (state) => {
      setFloating(isAlwaysOnTopActive());
      if (state !== "active") {
        return;
      }
      promptingConsent.current = false;
      const granted = canDrawOverlays();
      setOverlayGranted(granted);
      if (navigationActiveRef.current && granted) {
        setAlwaysOnTopEligible(true);
      }
    });
    const unsubscribe = subscribeAlwaysOnTop(setFloating);
    return () => {
      appState.remove();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android" || !navigationActive) {
      return;
    }
    const sync = () => {
      const active = isAlwaysOnTopActive();
      setFloating((current) => (current === active ? current : active));
    };
    sync();
    const timer = setInterval(sync, 200);
    return () => clearInterval(timer);
  }, [navigationActive]);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    if (promptingConsent.current || !overlayGranted) {
      setAlwaysOnTopEligible(false);
    } else {
      setAlwaysOnTopEligible(navigationActive);
    }
    if (floatingRef.current && (!navigationActive || !overlayGranted)) {
      dismissAlwaysOnTop();
    }
  }, [navigationActive, overlayGranted]);

  useEffect(() => {
    if (Platform.OS !== "android" || !overlayChecked || !consentReady || sessionStatus === "loading") {
      return;
    }
    if (!shouldAskAlwaysOnTopConsent({ granted: overlayGranted, asked: consentAsked || askedConsent.current })) {
      return;
    }
    askedConsent.current = true;
    setConsentAsked(true);
    promptingConsent.current = true;
    setAlwaysOnTopEligible(false);
    void rememberAlwaysOnTopConsentAsked();
    promptOverlayPermission();
  }, [overlayChecked, consentReady, consentAsked, overlayGranted, sessionStatus]);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    if (!floating || !overlayGranted) {
      setNativeOverlayActive(false);
      setOverlayReady(false);
      clearNativeAlert();
      return;
    }
    rememberAlertPrefs(visualAlert);
    armNativeAlert(visualAlert);
    setOverlayReady(true);
    setNativeOverlayActive(true);
  }, [floating, overlayGranted, visualAlert]);

  return { visualAlert, floating, overlayGranted, overlayReady, onActiveNavigationChange };
}
