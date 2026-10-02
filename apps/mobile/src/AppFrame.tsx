import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardAvoidingView, KeyboardProvider } from "react-native-keyboard-controller";
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export function AppFrame({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <View style={styles.frame}>
          <SafeAreaView style={styles.frame} edges={["top", "right", "bottom", "left"]}>
            <KeyboardAvoidingView style={styles.frame} behavior="height" automaticOffset>
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
