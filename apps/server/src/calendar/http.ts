import { stopRoles } from "@groundops/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { findActiveSession } from "../identity/sessions.js";
import { readBearer } from "../identity/tokens.js";
import {
  authorSortie,
  defaultScheduleDeps,
  ensureDriver,
  readCalendar,
  recordObservation,
  reviseSortie,
  type ObservationInput,
  type ScheduleDeps,
  type SortieInput,
} from "./calendar.js";

const stopBody = z.object({
  role: z.enum(stopRoles),
  label: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});

const writeBody = z.object({
  label: z.string(),
  arrivalAt: z.string().nullable(),
  passengerName: z.string().nullable(),
  passengerPhone: z.string().nullable(),
  stops: z.array(stopBody),
});

const observationBody = z.object({
  observedAt: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracyMeters: z.number().nullable(),
});

const rangeQuery = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

const sortieParams = z.object({
  id: z.uuid(),
});

export function registerCalendarRoutes(app: FastifyInstance, deps: ScheduleDeps = defaultScheduleDeps): void {
  app.post("/drivers/current", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const driver = await ensureDriver(active.user);
    return reply.send(driver);
  });

  app.get("/calendar", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = rangeQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    const result = await readCalendar(active.user, from, to);
    if (result === "invalid-range") {
      return reply.code(400).send({ error: "invalid request" });
    }
    if (result === "no-driver") {
      return reply.code(409).send({ error: "no driver" });
    }
    return reply.send({ sorties: result });
  });

  app.post("/sorties", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const input = readWrite(request.body);
    if (!input) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await authorSortie(active.user, input, deps);
    if (result === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    if (result === "no-driver") {
      return reply.code(409).send({ error: "no driver" });
    }
    if (result === "no-location") {
      return reply.code(409).send({ error: "no location" });
    }
    if (result === "unavailable") {
      return reply.code(503).send({ error: "schedule unavailable" });
    }
    return reply.code(201).send(result);
  });

  app.patch("/sorties/:id", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const params = sortieParams.safeParse(request.params);
    const input = readWrite(request.body);
    if (!params.success || !input) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await reviseSortie(active.user, params.data.id, input, deps);
    if (result === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    if (result === "not-found") {
      return reply.code(404).send({ error: "not found" });
    }
    if (result === "no-location") {
      return reply.code(409).send({ error: "no location" });
    }
    if (result === "unavailable") {
      return reply.code(503).send({ error: "schedule unavailable" });
    }
    return reply.send(result);
  });

  app.post("/location-observations", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const input = readObservation(request.body);
    if (!input) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await recordObservation(active.user, input, deps);
    if (result === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    if (result === "no-driver") {
      return reply.code(409).send({ error: "no driver" });
    }
    return reply.code(204).send();
  });
}

function readWrite(body: unknown): SortieInput | null {
  const parsed = writeBody.safeParse(body);
  if (!parsed.success) {
    return null;
  }
  const arrivalAt = parsed.data.arrivalAt === null ? null : new Date(parsed.data.arrivalAt);
  if (arrivalAt !== null && Number.isNaN(arrivalAt.getTime())) {
    return null;
  }
  return {
    label: parsed.data.label,
    arrivalAt,
    passengerName: parsed.data.passengerName,
    passengerPhone: parsed.data.passengerPhone,
    stops: parsed.data.stops,
  };
}

function readObservation(body: unknown): ObservationInput | null {
  const parsed = observationBody.safeParse(body);
  if (!parsed.success) {
    return null;
  }
  const observedAt = new Date(parsed.data.observedAt);
  if (Number.isNaN(observedAt.getTime())) {
    return null;
  }
  return {
    observedAt,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    accuracyMeters: parsed.data.accuracyMeters,
  };
}

async function findPresentedSession(authorization: string | string[] | undefined) {
  const token = readBearer(oneHeader(authorization));
  if (!token) {
    return null;
  }
  return findActiveSession(token);
}

function oneHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
