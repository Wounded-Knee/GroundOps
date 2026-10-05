import type { ReactNode } from "react";
import Constants from "expo-constants";
import { useEffect, useRef } from "react";
import { Dimensions, Keyboard, NativeModules, Platform, StyleSheet, View } from "react-native";
import {
  KeyboardAvoidingView,
  KeyboardProvider,
  useKeyboardHandler,
} from "react-native-keyboard-controller";
import { runOnJS } from "react-native-reanimated";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

export function AppFrame({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <KeyboardLayoutProbe />
        <View
          style={styles.frame}
          onLayout={(event) => {
            if (Platform.OS !== "android") {
              return;
            }
            const { height, width } = event.nativeEvent.layout;
            // #region agent log
            debugLog("C", "AppFrame.tsx:rootLayout", "root frame layout", {
              height,
              width,
              windowH: Dimensions.get("window").height,
              screenH: Dimensions.get("screen").height,
              screenMinusWindow: Dimensions.get("screen").height - Dimensions.get("window").height,
            });
            // #endregion
          }}
        >
          <SafeAreaView style={styles.frame} edges={["top", "right", "bottom", "left"]}>
            <KeyboardAvoidingView
              style={styles.frame}
              behavior="height"
              automaticOffset
              onLayout={(event) => {
                if (Platform.OS !== "android") {
                  return;
                }
                const { height, width } = event.nativeEvent.layout;
                // #region agent log
                debugLog("A", "AppFrame.tsx:kavLayout", "KeyboardAvoidingView layout", {
                  height,
                  width,
                  windowH: Dimensions.get("window").height,
                  screenH: Dimensions.get("screen").height,
                  screenMinusWindow:
                    Dimensions.get("screen").height - Dimensions.get("window").height,
                });
                // #endregion
              }}
            >
              {children}
            </KeyboardAvoidingView>
          </SafeAreaView>
          {overlay}
        </View>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

/** Side-effect-only probe: no layout wrappers. */
function KeyboardLayoutProbe() {
  const insets = useSafeAreaInsets();
  const lastWindowH = useRef(Dimensions.get("window").height);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    const win = Dimensions.get("window");
    const screen = Dimensions.get("screen");
    lastWindowH.current = win.height;
    // #region agent log
    debugLog("B", "AppFrame.tsx:mount", "initial dimensions", {
      windowH: win.height,
      windowW: win.width,
      screenH: screen.height,
      screenW: screen.width,
      insetBottom: insets.bottom,
      insetTop: insets.top,
      screenMinusWindow: screen.height - win.height,
      ingestUrls: debugIngestUrls(),
      hostUri: Constants.expoConfig?.hostUri ?? null,
      scriptURL: debugBundleScriptUrl() ?? null,
    });
    // #endregion

    const dimSub = Dimensions.addEventListener("change", ({ window, screen: nextScreen }) => {
      // #region agent log
      debugLog("B", "AppFrame.tsx:dimensions", "dimensions change", {
        windowH: window.height,
        screenH: nextScreen.height,
        deltaWindow: window.height - lastWindowH.current,
        screenMinusWindow: nextScreen.height - window.height,
      });
      // #endregion
      lastWindowH.current = window.height;
    });

    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      const nextWin = Dimensions.get("window");
      const nextScreen = Dimensions.get("screen");
      // #region agent log
      debugLog("E", "AppFrame.tsx:keyboardDidShow", "RN keyboard did show", {
        kbHeight: e.endCoordinates.height,
        windowH: nextWin.height,
        screenH: nextScreen.height,
        screenMinusWindow: nextScreen.height - nextWin.height,
      });
      // #endregion
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", (e) => {
      const nextWin = Dimensions.get("window");
      const nextScreen = Dimensions.get("screen");
      // #region agent log
      debugLog("E", "AppFrame.tsx:keyboardDidHide", "RN keyboard did hide", {
        kbHeight: e.endCoordinates?.height ?? null,
        windowH: nextWin.height,
        screenH: nextScreen.height,
        screenMinusWindow: nextScreen.height - nextWin.height,
      });
      // #endregion
    });

    return () => {
      dimSub.remove();
      showSub.remove();
      hideSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    // #region agent log
    debugLog("D", "AppFrame.tsx:insets", "safe area insets", {
      top: insets.top,
      bottom: insets.bottom,
      left: insets.left,
      right: insets.right,
      windowH: Dimensions.get("window").height,
      screenH: Dimensions.get("screen").height,
    });
    // #endregion
  }, [insets.top, insets.bottom, insets.left, insets.right]);

  useKeyboardHandler(
    {
      onStart: (e) => {
        "worklet";
        runOnJS(logKeyboardController)("onStart", e.height, e.progress);
      },
      onEnd: (e) => {
        "worklet";
        runOnJS(logKeyboardController)("onEnd", e.height, e.progress);
      },
    },
    [],
  );

  return null;
}

function logKeyboardController(phase: string, height: number, progress: number): void {
  const win = Dimensions.get("window");
  const screen = Dimensions.get("screen");
  // #region agent log
  debugLog("A", `AppFrame.tsx:kb${phase}`, `keyboard controller ${phase}`, {
    height,
    progress,
    windowH: win.height,
    screenH: screen.height,
    screenMinusWindow: screen.height - win.height,
  });
  // #endregion
}

// #region agent log
const DEBUG_INGEST_PATH = "/ingest/bba8e72d-4c30-46ba-aea7-aa7d479478a0";
/** Cursor ingest binds 127.0.0.1:7255; a LAN proxy listens on 7256 for the device. */
const DEBUG_LAN_PORT = 7256;
const DEBUG_LOCAL_PORT = 7255;

function debugIngestUrls(): string[] {
  const urls: string[] = [
    `http://127.0.0.1:${DEBUG_LOCAL_PORT}${DEBUG_INGEST_PATH}`,
    `http://10.0.2.2:${DEBUG_LOCAL_PORT}${DEBUG_INGEST_PATH}`,
  ];
  for (const candidate of [Constants.expoConfig?.hostUri, debugBundleScriptUrl()]) {
    const host = debugHostnameOf(candidate);
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      urls.push(`http://${host}:${DEBUG_LAN_PORT}${DEBUG_INGEST_PATH}`);
      urls.push(`http://${host}:${DEBUG_LOCAL_PORT}${DEBUG_INGEST_PATH}`);
    }
  }
  // Known host IP for this machine on the phone's subnet (wireless adb).
  urls.push(`http://192.168.168.37:${DEBUG_LAN_PORT}${DEBUG_INGEST_PATH}`);
  return [...new Set(urls)];
}

function debugHostnameOf(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return undefined;
  }
}

function debugBundleScriptUrl(): string | undefined {
  const sourceCode = NativeModules.SourceCode as
    | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
    | undefined;
  const scriptUrl = sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
  return typeof scriptUrl === "string" && scriptUrl.length > 0 ? scriptUrl : undefined;
}

function debugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  const payload = JSON.stringify({
    sessionId: "eda134",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  });
  for (const url of debugIngestUrls()) {
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "eda134",
      },
      body: payload,
    }).catch(() => {});
  }
  console.log(`[DBG-eda134] ${payload}`);
}
// #endregion

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
});
