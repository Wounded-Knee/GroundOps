import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
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
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <View style={styles.frame}>
        <SafeAreaView style={styles.frame} edges={edgeToEdge ? [] : ["top", "right", "bottom", "left"]}>
          {children}
        </SafeAreaView>
        {overlay}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
});
