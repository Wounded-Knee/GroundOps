import { Pressable, StyleSheet, Text } from "react-native";

export const availableYellow = "#F5C400";
const availableInk = "#000000";

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
  const backgroundColor = current ? availableYellow : availableInk;
  const color = current ? availableInk : availableYellow;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !loaded || busy, selected: current }}
      disabled={!loaded || busy}
      onPress={onToggle}
      style={[styles.bar, { backgroundColor }]}
    >
      <Text style={[styles.label, { color }]}>{label}</Text>
      {message ? <Text style={[styles.message, { color }]}>{message}</Text> : null}
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
    fontSize: 16,
    fontWeight: "700",
  },
  message: {
    fontSize: 13,
    marginTop: 2,
  },
});
