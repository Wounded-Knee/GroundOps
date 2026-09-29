import { Pressable, StyleSheet, Text, View } from "react-native";

export function SettingsScreen({
  signOutMessage,
  onSignOut,
}: {
  signOutMessage: string | null;
  onSignOut: () => void;
}) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Settings</Text>
      {signOutMessage ? <Text style={styles.message}>{signOutMessage}</Text> : null}
      <Pressable style={styles.button} onPress={onSignOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    marginBottom: 24,
  },
  message: {
    marginBottom: 16,
    textAlign: "center",
    fontSize: 16,
  },
  button: {
    backgroundColor: "#111",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
  },
});
