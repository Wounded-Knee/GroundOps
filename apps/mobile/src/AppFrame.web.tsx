import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView style={styles.frame} edges={["top", "right", "bottom", "left"]}>
        {children}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
});
