import { useEffect, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import {
  AndroidSoftInputModes,
  KeyboardAvoidingView,
  KeyboardController,
  KeyboardProvider,
} from "react-native-keyboard-controller";
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView, type Edge } from "react-native-safe-area-context";

export function AppFrame({
  children,
  overlay,
  edgeToEdge = false,
  omitTopInset = false,
}: {
  children: ReactNode;
  overlay?: ReactNode;
  edgeToEdge?: boolean;
  /** Drop the status-bar pad so a full-bleed surface can draw under it. */
  omitTopInset?: boolean;
}) {
  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    // One inset: the avoiding view pads. adjustResize would shrink the window as well
    // and push the bottom-anchored meter past the visible area.
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    if (edgeToEdge) {
      void KeyboardController.dismiss();
    }
  }, [edgeToEdge]);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <View style={styles.frame}>
          <SafeAreaView style={styles.frame} edges={frameEdges(edgeToEdge, omitTopInset)}>
            <KeyboardAvoidingView
              style={styles.frame}
              behavior="padding"
              automaticOffset
              enabled={!edgeToEdge}
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

function frameEdges(edgeToEdge: boolean, omitTopInset: boolean): Edge[] {
  if (edgeToEdge) {
    return [];
  }
  if (omitTopInset) {
    return ["right", "bottom", "left"];
  }
  return ["top", "right", "bottom", "left"];
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
});
