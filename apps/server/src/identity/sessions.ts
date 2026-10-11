import type { User } from "@groundops/contracts";
import { and, eq, isNull } from "drizzle-orm";
import { isPlatformAdministrator } from "../platform/administrator.js";
import type { GoogleIdentity } from "./google.js";
import { hashSessionToken, newSessionToken } from "./tokens.js";
import { db } from "../db.js";
import { session, user, userCredential } from "../schema.js";

const googleProvider = "google";

export type ActiveSession = {
  sessionId: string;
  user: User;
};

export async function createSession(identity: GoogleIdentity): Promise<{ token: string; user: User }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await insertSession(identity);
    } catch (error) {
      if (attempt === 0 && isUniqueViolation(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("session creation failed");
}

export async function findActiveSession(token: string): Promise<ActiveSession | null> {
  const rows = await db
    .select({
      sessionId: session.id,
      userId: user.id,
      displayName: user.displayName,
      email: user.email,
    })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(and(eq(session.tokenHash, hashSessionToken(token)), isNull(session.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    sessionId: row.sessionId,
    user: presentUser({
      id: row.userId,
      displayName: row.displayName,
      email: row.email,
    }),
  };
}

/** Revokes the presented session. Returns its id when a row changed. */
export async function revokeActiveSession(token: string): Promise<string | null> {
  const rows = await db
    .update(session)
    .set({ revokedAt: new Date() })
    .where(and(eq(session.tokenHash, hashSessionToken(token)), isNull(session.revokedAt)))
    .returning({ id: session.id });

  return rows[0]?.id ?? null;
}

async function insertSession(identity: GoogleIdentity): Promise<{ token: string; user: User }> {
  const token = newSessionToken();
  const tokenHash = hashSessionToken(token);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ userId: userCredential.userId })
      .from(userCredential)
      .where(and(eq(userCredential.provider, googleProvider), eq(userCredential.subject, identity.sub)))
      .limit(1);

    const linked = existing[0];
    const stored = linked
      ? await updateUser(tx, linked.userId, identity)
      : await createUser(tx, identity);

    await tx.insert(session).values({ userId: stored.id, tokenHash });
    return { token, user: stored };
  });
}

async function updateUser(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  identity: GoogleIdentity,
): Promise<User> {
  const rows = await tx
    .update(user)
    .set({ displayName: identity.displayName, email: identity.email })
    .where(eq(user.id, userId))
    .returning({ id: user.id, displayName: user.displayName, email: user.email });

  const row = rows[0];
  if (!row) {
    throw new Error("user disappeared during sign-in");
  }
  return presentUser(row);
}

async function createUser(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  identity: GoogleIdentity,
): Promise<User> {
  const rows = await tx
    .insert(user)
    .values({ displayName: identity.displayName, email: identity.email })
    .returning({ id: user.id, displayName: user.displayName, email: user.email });

  const row = rows[0];
  if (!row) {
    throw new Error("user insert returned no row");
  }

  await tx.insert(userCredential).values({
    userId: row.id,
    provider: googleProvider,
    subject: identity.sub,
  });

  return presentUser(row);
}

function presentUser(row: { id: string; displayName: string | null; email: string | null }): User {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    platformAdministrator: isPlatformAdministrator(row.email),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ("code" in error && error.code === "23505") {
    return true;
  }
  if ("cause" in error) {
    return isUniqueViolation(error.cause);
  }
  return false;
}
