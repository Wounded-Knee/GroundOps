import { availabilityThresholdMaxMinutes } from "@groundops/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { findActiveSession } from "../identity/sessions.js";
import { readBearer } from "../identity/tokens.js";
import { checkInAvailability, readAvailability, setAvailability } from "./availability.js";
import { readAvailabilitySettings, replaceAvailabilitySettings } from "./settings.js";

const setBody = z.object({
  available: z.boolean(),
});

const coordinateBody = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
});

const settingsBody = z.object({
  thresholdMinutes: z.number().int().min(0).max(availabilityThresholdMaxMinutes),
  autoSetUnavailable: z.boolean(),
  autoSetAvailable: z.boolean(),
  geofence: z.array(coordinateBody).refine((ring) => ring.length === 0 || ring.length >= 3),
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

  app.get("/availability/settings", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await readAvailabilitySettings(active.user));
  });

  app.put("/availability/settings", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = settingsBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const saved = await replaceAvailabilitySettings(active.user, parsed.data, deps.now());
    if (saved === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.send(saved);
  });
}

async function findPresentedSession(authorization: string | string[] | undefined) {
  const token = readBearer(Array.isArray(authorization) ? authorization[0] : authorization);
  if (!token) {
    return null;
  }
  return findActiveSession(token);
}
