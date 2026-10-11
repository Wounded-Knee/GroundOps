import { Pressable, StyleSheet, Text } from "react-native";
import { withAlpha } from "./theme";

const availableYellow = "#F5C400";

export function AvailabilityStatus({
  current,
  loaded,
  busy,
  message,
  onToggle,
}: {
  current: boolean;
  loaded: boolean;
  busy: boolean;
  message: string | null;
  onToggle: () => void;
}) {
  const label = current ? "Available" : "Not available";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !loaded || busy, selected: current }}
      disabled={!loaded || busy}
      onPress={onToggle}
      style={[styles.bar, { backgroundColor: withAlpha(availableYellow, current ? 1 : 0.35) }]}
    >
      <Text style={styles.label}>{label}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  label: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "700",
  },
  message: {
    color: "#111111",
    fontSize: 13,
    marginTop: 2,
  },
});
