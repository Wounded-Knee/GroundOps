import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readGoogleClientIds, verifyGoogleIdToken } from "./identity/google.js";
import { createSession, findActiveSession, revokeActiveSession } from "./identity/sessions.js";
import { signInWithGoogle } from "./identity/sign-in.js";
import { readBearer } from "./identity/tokens.js";
import { closeSessionSockets } from "./gateway.js";

const googleClientIds = readGoogleClientIds();
if (googleClientIds.length === 0) {
  throw new Error(
    "At least one of GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, or GOOGLE_IOS_CLIENT_ID is required",
  );
}

const createSessionBody = z.object({
  googleIdToken: z.string().min(1),
});

export function registerSessionRoutes(app: FastifyInstance): void {
  app.post("/sessions", async (request, reply) => {
    const parsed = createSessionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }

    const result = await signInWithGoogle(
      parsed.data.googleIdToken,
      (token) => verifyGoogleIdToken(token, googleClientIds),
      createSession,
    );
    if (result === "rejected") {
      return reply.code(401).send({ error: "sign-in failed" });
    }
    return reply.code(201).send(result);
  });

  app.get("/me", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(active.user);
  });

  app.delete("/sessions/current", async (request, reply) => {
    const token = readBearer(headerValue(request.headers.authorization));
    if (!token) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const sessionId = await revokeActiveSession(token);
    if (!sessionId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    closeSessionSockets(sessionId);
    return reply.code(204).send();
  });
}

async function findPresentedSession(authorization: string | string[] | undefined) {
  const token = readBearer(headerValue(authorization));
  if (!token) {
    return null;
  }
  return findActiveSession(token);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
