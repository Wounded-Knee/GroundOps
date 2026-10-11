import type { CreateSessionRequest, CreateSessionResponse, User } from "@groundops/contracts";

const sessionKey = "groundops.session";

export { sessionKey };

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
  try {
    const response = await fetch(`${apiUrl}/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      return "unauthorized";
    }
    if (!response.ok) {
      return "unreachable";
    }
    const body: unknown = await response.json();
    return isUser(body) ? body : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function revokeSession(
  apiUrl: string,
  token: string,
): Promise<"revoked" | "unauthorized" | "unreachable"> {
  try {
    const response = await fetch(`${apiUrl}/sessions/current`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 204) {
      return "revoked";
    }
    if (response.status === 401) {
      return "unauthorized";
    }
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

export function liveSocketUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** React Native's WebSocket sends handshake headers. The DOM type does not list that argument. */
export function openAuthenticatedSocket(apiUrl: string, token: string): WebSocket {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
