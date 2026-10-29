import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendDomainResult } from "../http/result.js";
import { availabilitySettingsSchema } from "../http/schemas.js";
import { registerRequestSession } from "../http/session.js";
import { checkInAvailability, readAvailability, setAvailability } from "./availability.js";
import { readAvailabilitySettings, replaceAvailabilitySettings } from "./settings.js";

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
  registerRequestSession(app);

  app.get("/availability", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await readAvailability(request.session.user, deps.now()));
  });

  app.put("/availability", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = setBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.send(await setAvailability(request.session.user, parsed.data.available, deps.now()));
  });

  app.post("/availability/check-in", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await checkInAvailability(request.session.user, deps.now()));
  });

  app.get("/availability/settings", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await readAvailabilitySettings(request.session.user));
  });

  app.put("/availability/settings", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = availabilitySettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.send(await replaceAvailabilitySettings(request.session.user, parsed.data, deps.now()));
  });
}
