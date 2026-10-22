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
    if (!edgeToEdge) {
      KeyboardController.setDefaultMode();
      return;
    }
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    void KeyboardController.dismiss();
  }, [edgeToEdge]);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <View style={styles.frame}>
          <SafeAreaView style={styles.frame} edges={edgeToEdge ? [] : ["top", "right", "bottom", "left"]}>
            <KeyboardAvoidingView
              style={[styles.frame, edgeToEdge ? styles.noKeyboardInset : null]}
              behavior="padding"
              automaticOffset
              keyboardVerticalOffset={edgeToEdge ? floatingKeyboardOffset : 0}
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

/** Large enough that the avoiding view's overlap math stays at zero in the floating window. */
const floatingKeyboardOffset = -1_000_000;

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
  noKeyboardInset: {
    paddingBottom: 0,
  },
});
