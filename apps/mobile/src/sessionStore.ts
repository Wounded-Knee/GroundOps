import type { User } from "@groundops/contracts";
import { deleteSecureString, readSecureString, writeSecureString } from "./secureString";

const sessionKey = "groundops.session";
const userKey = "groundops.user";
const missingSessionStorage = "Could not reach the server.";

export async function readStoredSession(): Promise<string | null> {
  return readSecureString(sessionKey, missingSessionStorage);
}

export async function writeStoredSession(token: string): Promise<void> {
  await writeSecureString(sessionKey, token, missingSessionStorage);
}

export async function deleteStoredSession(): Promise<void> {
  await deleteSecureString(sessionKey, missingSessionStorage);
  await deleteSecureString(userKey, missingSessionStorage);
}

export async function readStoredUser(): Promise<User | null> {
  const raw = await readSecureString(userKey, missingSessionStorage);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeStoredUser(user: User): Promise<void> {
  await writeSecureString(userKey, JSON.stringify(user), missingSessionStorage);
}

function isStoredUser(value: unknown): value is User {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    (record.displayName === null || typeof record.displayName === "string") &&
    (record.email === null || typeof record.email === "string") &&
    typeof record.platformAdministrator === "boolean"
  );
}
