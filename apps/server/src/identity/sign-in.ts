import type { CreateSessionResponse } from "@groundops/contracts";
import type { GoogleIdentity } from "./google.js";

/**
 * Persists a session only after Google verification succeeds.
 * A rejected token does not call persist, so no user row is written.
 */
export async function signInWithGoogle(
  googleIdToken: string,
  verify: (googleIdToken: string) => Promise<GoogleIdentity | null>,
  persist: (identity: GoogleIdentity) => Promise<CreateSessionResponse>,
): Promise<CreateSessionResponse | "rejected"> {
  const identity = await verify(googleIdToken);
  if (!identity) {
    return "rejected";
  }
  return persist(identity);
}
