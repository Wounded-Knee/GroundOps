import { OAuth2Client } from "google-auth-library";

export type GoogleIdentity = {
  sub: string;
  displayName: string | null;
  email: string | null;
};

const accountsIssuer = new Set(["https://accounts.google.com", "accounts.google.com"]);

const platformClientIdEnv = [
  "GOOGLE_WEB_CLIENT_ID",
  "GOOGLE_ANDROID_CLIENT_ID",
  "GOOGLE_IOS_CLIENT_ID",
] as const;

/** Client ids configured for web, Android, and iOS. Empty values are omitted. */
export function readGoogleClientIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return platformClientIdEnv.flatMap((key) => {
    const value = env[key];
    return value ? [value] : [];
  });
}

/**
 * Verifies a Google ID token. Returns null when the token is not acceptable.
 * A null result must not create a user or a session.
 * The audience must be one of the platform client ids that requested the token.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientIds: readonly string[],
): Promise<GoogleIdentity | null> {
  if (clientIds.length === 0) {
    return null;
  }
  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({ idToken, audience: [...clientIds] });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.iss || !accountsIssuer.has(payload.iss)) {
      return null;
    }
    return {
      sub: payload.sub,
      displayName: present(payload.name),
      email: present(payload.email),
    };
  } catch {
    return null;
  }
}

function present(value: string | undefined): string | null {
  if (!value || value.length === 0) {
    return null;
  }
  return value;
}
