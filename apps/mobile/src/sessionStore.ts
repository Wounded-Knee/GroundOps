import { deleteSecureString, readSecureString, writeSecureString } from "./secureString";

const sessionKey = "groundops.session";
const missingSessionStorage = "Could not reach the server.";

export async function readStoredSession(): Promise<string | null> {
  return readSecureString(sessionKey, missingSessionStorage);
}

export async function writeStoredSession(token: string): Promise<void> {
  await writeSecureString(sessionKey, token, missingSessionStorage);
}

export async function deleteStoredSession(): Promise<void> {
  await deleteSecureString(sessionKey, missingSessionStorage);
}
