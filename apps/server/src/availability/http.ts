import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { findActiveSession } from "../identity/sessions.js";
import { readBearer } from "../identity/tokens.js";
import { checkInAvailability, readAvailability, setAvailability } from "./availability.js";

const setBody = z.object({
  available: z.boolean(),
});

export type AvailabilityDeps = {
  now: () => Date;
};

const defaultDeps: AvailabilityDeps = {
  now: () => new Date(),
};

export function registerAvailabilityRoutes(app: FastifyInstance, deps: AvailabilityDeps = defaultDeps): void {
  app.get("/availability", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await readAvailability(active.user, deps.now()));
  });

  app.put("/availability", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = setBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.send(await setAvailability(active.user, parsed.data.available, deps.now()));
  });

  app.post("/availability/check-in", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await checkInAvailability(active.user, deps.now()));
  });
}

async function findPresentedSession(authorization: string | string[] | undefined) {
  const token = readBearer(Array.isArray(authorization) ? authorization[0] : authorization);
  if (!token) {
    return null;
  }
  return findActiveSession(token);
}
