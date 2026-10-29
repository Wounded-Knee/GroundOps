import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { closeSessionSockets } from "../gateway.js";
import { sendDomainResult } from "../http/result.js";
import { registerRequestSession } from "../http/session.js";
import { verifyGoogleIdToken } from "./google.js";
import { createSession, revokeActiveSession } from "./sessions.js";
import { signInWithGoogle } from "./sign-in.js";

const createSessionBody = z.object({
  googleIdToken: z.string().min(1),
});

export function registerSessionRoutes(app: FastifyInstance, googleClientIds: readonly string[]): void {
  registerRequestSession(app);

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
      return sendDomainResult(reply, result);
    }
    return reply.code(201).send(result);
  });

  app.get("/me", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(request.session.user);
  });

  app.delete("/sessions/current", async (request, reply) => {
    if (!request.sessionToken) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const sessionId = await revokeActiveSession(request.sessionToken);
    if (!sessionId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    closeSessionSockets(sessionId);
    return reply.code(204).send();
  });
}
