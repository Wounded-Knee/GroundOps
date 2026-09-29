import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { sessionKey } from "./sessionClient";

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export async function readStoredSession(): Promise<string | null> {
  if (Platform.OS === "web") {
    return webStorage().getItem(sessionKey);
  }
  return SecureStore.getItemAsync(sessionKey);
}

export async function writeStoredSession(token: string): Promise<void> {
  if (Platform.OS === "web") {
    webStorage().setItem(sessionKey, token);
    return;
  }
  await SecureStore.setItemAsync(sessionKey, token);
}

export async function deleteStoredSession(): Promise<void> {
  if (Platform.OS === "web") {
    webStorage().removeItem(sessionKey);
    return;
  }
  await SecureStore.deleteItemAsync(sessionKey);
}

function webStorage(): WebStorage {
  const storage = (globalThis as { localStorage?: WebStorage }).localStorage;
  if (!storage) {
    throw new Error("Could not reach the server.");
  }
  return storage;
}
