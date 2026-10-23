import { useEffect, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import {
  AndroidSoftInputModes,
  KeyboardAvoidingView,
  KeyboardController,
  KeyboardProvider,
} from "react-native-keyboard-controller";
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export function AppFrame({
  children,
  overlay,
  edgeToEdge = false,
}: {
  children: ReactNode;
  overlay?: ReactNode;
  edgeToEdge?: boolean;
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
          <SafeAreaView style={styles.frame} edges={edgeToEdge ? [] : ["top", "right", "bottom", "left"]}>
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

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
});
