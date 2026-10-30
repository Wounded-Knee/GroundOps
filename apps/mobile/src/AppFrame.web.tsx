import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
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
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <View style={styles.frame}>
        <SafeAreaView style={styles.frame} edges={frameEdges(edgeToEdge, omitTopInset)}>
          {children}
        </SafeAreaView>
        {overlay}
      </View>
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
