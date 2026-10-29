import type { CreateSessionRequest, CreateSessionResponse, User } from "@groundops/contracts";
import { Platform } from "react-native";
import { fetchAuthorized, isRecord } from "./authorizedFetch";

export async function createSession(
  apiUrl: string,
  googleIdToken: string,
): Promise<CreateSessionResponse | "rejected" | "unreachable"> {
  try {
    const response = await fetch(`${apiUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ googleIdToken } satisfies CreateSessionRequest),
    });
    if (response.status === 400 || response.status === 401) {
      return "rejected";
    }
    if (!response.ok) {
      if (__DEV__) {
        console.log(`POST /sessions returned ${response.status}.`);
      }
      return "unreachable";
    }
    const body: unknown = await response.json();
    return isCreateSessionResponse(body) ? body : "rejected";
  } catch {
    return "unreachable";
  }
}

export async function readCurrentUser(
  apiUrl: string,
  token: string,
): Promise<User | "unauthorized" | "unreachable"> {
  const response = await fetchAuthorized(`${apiUrl}/me`, token);
  if (typeof response === "string") {
    return response;
  }
  if (!response.ok) {
    return "unreachable";
  }
  const body: unknown = await response.json();
  return isUser(body) ? body : "unreachable";
}

export async function revokeSession(
  apiUrl: string,
  token: string,
): Promise<"revoked" | "unauthorized" | "unreachable"> {
  const response = await fetchAuthorized(`${apiUrl}/sessions/current`, token, { method: "DELETE" });
  if (response === "unauthorized" || response === "unreachable") {
    return response;
  }
  return response.status === 204 ? "revoked" : "unreachable";
}

export function liveSocketUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** React Native's WebSocket sends handshake headers. The browser cannot, so web offers the token as a protocol. */
export function openAuthenticatedSocket(apiUrl: string, token: string): WebSocket {
  if (Platform.OS === "web") {
    return new WebSocket(liveSocketUrl(apiUrl), ["bearer", token]);
  }
  const Socket = WebSocket as unknown as {
    new (
      uri: string,
      protocols: null,
      options: { headers: { Authorization: string } },
    ): WebSocket;
  };
  return new Socket(liveSocketUrl(apiUrl), null, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function isCreateSessionResponse(value: unknown): value is CreateSessionResponse {
  if (!isRecord(value) || typeof value.token !== "string" || value.token.length === 0) {
    return false;
  }
  return isUser(value.user);
}

function isUser(value: unknown): value is User {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    return false;
  }
  return (
    isNullableString(value.displayName) &&
    isNullableString(value.email) &&
    typeof value.platformAdministrator === "boolean"
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

