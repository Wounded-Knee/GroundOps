import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { availableYellow } from "./AvailabilityStatus";
import type { NetworkFault } from "./networkStatus";

const iconName = {
  internet: "cloud-offline",
  api: "server",
  health: "pulse",
} as const;

const label = {
  internet: "No internet connection",
  api: "Cannot reach the server",
  health: "Server is unhealthy",
} as const;

export function NetworkStatusIcon({ fault }: { fault: NetworkFault | null }) {
  if (!fault) {
    return null;
  }
  return (
    <View accessibilityRole="image" accessibilityLabel={label[fault]} style={styles.icon}>
      <Ionicons name={iconName[fault]} size={22} color={availableYellow} />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    marginLeft: 12,
    marginTop: 15,
  },
});
