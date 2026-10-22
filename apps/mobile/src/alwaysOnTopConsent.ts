import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const storageKey = "groundops.alwaysOnTopConsent";
const askedValue = "asked";

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

let asked = false;
let loaded: Promise<boolean> | null = null;

export function hasAskedAlwaysOnTopConsent(): boolean {
  return asked;
}

export function ensureAlwaysOnTopConsentLoaded(): Promise<boolean> {
  loaded ??= readRaw().then((raw) => {
    asked = raw === askedValue;
    return asked;
  });
  return loaded;
}

export async function rememberAlwaysOnTopConsentAsked(): Promise<void> {
  asked = true;
  await writeRaw(askedValue);
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === "web") {
    return webStorage()?.getItem(storageKey) ?? null;
  }
  return SecureStore.getItemAsync(storageKey);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === "web") {
    webStorage()?.setItem(storageKey, value);
    return;
  }
  await SecureStore.setItemAsync(storageKey, value);
}

function webStorage(): WebStorage | null {
  return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
}
