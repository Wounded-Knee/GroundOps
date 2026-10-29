import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const missingLocalStorage = "Could not reach local storage.";

export async function readSecureString(
  key: string,
  missingMessage = missingLocalStorage,
): Promise<string | null> {
  if (Platform.OS === "web") {
    return webStorage(missingMessage).getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function writeSecureString(
  key: string,
  value: string,
  missingMessage = missingLocalStorage,
): Promise<void> {
  if (Platform.OS === "web") {
    webStorage(missingMessage).setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecureString(key: string, missingMessage = missingLocalStorage): Promise<void> {
  if (Platform.OS === "web") {
    webStorage(missingMessage).removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function webStorage(missingMessage: string): WebStorage {
  const storage = (globalThis as { localStorage?: WebStorage }).localStorage;
  if (!storage) {
    throw new Error(missingMessage);
  }
  return storage;
}
