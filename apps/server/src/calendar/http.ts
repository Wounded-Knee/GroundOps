import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { findActiveSession } from "../identity/sessions.js";
import { readBearer } from "../identity/tokens.js";
import {
  authorSortie,
  commenceSortie,
  defaultScheduleDeps,
  ensureDriver,
  readCalendar,
  recordObservation,
  reviseSortie,
  type ObservationInput,
  type ScheduleDeps,
  type SortieInput,
} from "./calendar.js";
import { defaultSortieRouteDeps, computeSortieDrivingRoute, type SortieRouteDeps } from "./sortieRoute.js";
import { readTariff, replaceTariff } from "./tariff.js";

const stopBody = z.object({
  label: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  waitMinutes: z.number().int().nonnegative(),
  passenger: z.boolean(),
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

const coordinateSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
});

const sortieRouteBody = z.object({
  origin: coordinateSchema,
  firstStopPosition: z.number().int().nonnegative(),
});

const tariffBody = z.object({
  flagCents: z.number().int().nonnegative(),
  perMileCents: z.number().int().nonnegative(),
  perWaitMinuteCents: z.number().int().nonnegative(),
});

export function registerCalendarRoutes(
  app: FastifyInstance,
  deps: ScheduleDeps = defaultScheduleDeps,
  routeDeps: SortieRouteDeps = defaultSortieRouteDeps,
): void {
  app.post("/drivers/current", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const driver = await ensureDriver(active.user);
    return reply.send(driver);
  });

  app.get("/fare-rates", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const tariff = await readTariff(active.user);
    if (tariff === "no-driver") {
      return reply.code(409).send({ error: "no driver" });
    }
    return reply.send(tariff);
  });

  app.put("/fare-rates", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = tariffBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await replaceTariff(active.user, parsed.data);
    if (result === "no-driver") {
      return reply.code(409).send({ error: "no driver" });
    }
    if (result === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.send(result);
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

  app.post("/sorties/:id/commence", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = sortieParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await commenceSortie(active.user, params.data.id, deps);
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

  app.post("/sorties/:id/driving-route", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = sortieParams.safeParse(request.params);
    const body = sortieRouteBody.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await computeSortieDrivingRoute(
      active.user,
      params.data.id,
      body.data.origin,
      body.data.firstStopPosition,
      routeDeps,
    );
    if (result === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    if (result === "no-driver") {
      return reply.code(409).send({ error: "no driver" });
    }
    if (result === "not-found") {
      return reply.code(404).send({ error: "not found" });
    }
    if (result === "failed") {
      return reply.code(502).send({ error: "provider failed" });
    }
    if (result === "no-route") {
      return reply.code(422).send({ error: "no route" });
    }
    return reply.send({ route: result });
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
