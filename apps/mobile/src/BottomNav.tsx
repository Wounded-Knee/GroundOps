import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type SignedInDestination = "navigation" | "calendar" | "settings";

export function BottomNav({
  destination,
  composeOpen,
  onNavigate,
  onCompose,
}: {
  destination: SignedInDestination;
  composeOpen: boolean;
  onNavigate: (destination: SignedInDestination) => void;
  onCompose: () => void;
}) {
  return (
    <View style={styles.bar}>
      <Tab
        label="Navigation"
        active={destination === "navigation" && !composeOpen}
        onPress={() => onNavigate("navigation")}
        icon={(color) => (
          <Ionicons
            name={destination === "navigation" && !composeOpen ? "map" : "map-outline"}
            size={24}
            color={color}
          />
        )}
      />
      <Pressable
        accessibilityLabel="New Sortie"
        onPress={onCompose}
        style={[styles.plusHit, composeOpen ? styles.plusActive : null]}
      >
        <Text style={[styles.plusText, composeOpen ? styles.plusTextActive : null]}>+</Text>
      </Pressable>
      <Tab
        label="Settings"
        active={destination === "settings" && !composeOpen}
        onPress={() => onNavigate("settings")}
        icon={(color) => (
          <Ionicons
            name={destination === "settings" && !composeOpen ? "settings" : "settings-outline"}
            size={24}
            color={color}
          />
        )}
      />
      <Tab
        label="Calendar"
        active={destination === "calendar" && !composeOpen}
        onPress={() => onNavigate("calendar")}
        icon={(color) => (
          <Ionicons
            name={destination === "calendar" && !composeOpen ? "calendar" : "calendar-outline"}
            size={24}
            color={color}
          />
        )}
      />
    </View>
  );
}

function Tab({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: (color: string) => ReactNode;
}) {
  const color = active ? "#111" : "#666";
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={styles.tab}>
      {icon(color)}
      <Text style={[styles.tabLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ccc",
    backgroundColor: "#fff",
    paddingTop: 8,
    paddingBottom: 4,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: 11,
  },
  plusHit: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 8,
  },
  plusActive: {
    backgroundColor: "#1A73E8",
  },
  plusText: {
    color: "#fff",
    fontSize: 32,
    lineHeight: 34,
    fontWeight: "400",
    marginTop: -2,
  },
  plusTextActive: {
    color: "#fff",
  },
});
