import Constants from "expo-constants";
import { NativeModules } from "react-native";

export function resolveApiUrl(): string {
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
  return firstRoutableHost(Constants.expoConfig?.hostUri, bundleScriptUrl());
}

function firstRoutableHost(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const host = hostnameOf(candidate);
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return host;
    }
  }
  return undefined;
}

function hostnameOf(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return undefined;
  }
}

/**
 * The packager address of the running bundle. A dev build's manifest has no host,
 * and the new architecture exposes this only through the SourceCode turbo module.
 */
function bundleScriptUrl(): string | undefined {
  const fromTurbo = turboScriptUrl();
  if (fromTurbo) {
    return fromTurbo;
  }
  const sourceCode = NativeModules.SourceCode as
    | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
    | undefined;
  const scriptUrl = sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
  return typeof scriptUrl === "string" && scriptUrl.length > 0 ? scriptUrl : undefined;
}

function turboScriptUrl(): string | undefined {
  const proxy = (
    globalThis as {
      __turboModuleProxy?: (name: string) => { getConstants?: () => { scriptURL?: string } } | null;
    }
  ).__turboModuleProxy;
  const scriptUrl = proxy?.("SourceCode")?.getConstants?.()?.scriptURL;
  return typeof scriptUrl === "string" && scriptUrl.length > 0 ? scriptUrl : undefined;
}
