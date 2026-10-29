export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type AuthorizedFetchResult =
  | { kind: "ok"; response: Response }
  | { kind: "unauthorized" }
  | { kind: "status"; response: Response }
  | { kind: "unreachable" };

export async function authorizedFetch(
  url: string | URL,
  token: string,
  init?: RequestInit,
): Promise<AuthorizedFetchResult> {
  try {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401) {
      return { kind: "unauthorized" };
    }
    if (!response.ok) {
      return { kind: "status", response };
    }
    return { kind: "ok", response };
  } catch {
    return { kind: "unreachable" };
  }
}

export async function fetchAuthorized(
  url: string | URL,
  token: string,
  init?: RequestInit,
): Promise<Response | "unauthorized" | "unreachable"> {
  const result = await authorizedFetch(url, token, init);
  if (result.kind === "ok" || result.kind === "status") {
    return result.response;
  }
  return result.kind;
}
