import type { RealtimeEnvelope } from "@groundops/contracts";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

const apiUrl = resolveApiUrl();

/** The client compiles against the shared envelope and does not treat it as operational state. */
const liveMessage: RealtimeEnvelope | null = null;

export default function App() {
  const [health, setHealth] = useState("Loading health…");
  void liveMessage;

  useEffect(() => {
    let cancelled = false;

    async function loadHealth(): Promise<void> {
      try {
        const response = await fetch(`${apiUrl}/health`);
        const body: unknown = await response.json();
        if (!cancelled) {
          setHealth(JSON.stringify(body, null, 2));
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Health request failed";
          setHealth(`${message}\n${apiUrl}`);
        }
      }
    }

    void loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text>Open up App.tsx to start working on your app!</Text>
      <Text style={styles.health}>{health}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

function resolveApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const devHost = developmentHost();
  if (!devHost || !isLoopback(configured)) {
    return configured;
  }

  const url = new URL(configured);
  url.hostname = devHost;
  return url.origin;
}

function isLoopback(url: string): boolean {
  return url.includes("://localhost") || url.includes("://127.0.0.1");
}

function developmentHost(): string | undefined {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return undefined;
  }
  return host;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  health: {
    marginTop: 16,
    fontFamily: "monospace",
  },
});
