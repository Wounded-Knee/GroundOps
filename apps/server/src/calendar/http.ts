import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { findActiveSession } from "../identity/sessions.js";
import { readBearer } from "../identity/tokens.js";
import {
  assertStopArrival,
  authorSortie,
  commenceSortie,
  completeSortie,
  defaultScheduleDeps,
  ensureDriver,
  extendStopWait,
  previewSortie,
  readActivity,
  readCalendar,
  recordObservation,
  reviseSortie,
  type ObservationInput,
  type ScheduleDeps,
  type SortieInput,
} from "./calendar.js";
import { defaultSortieRouteDeps, computeSortieDrivingRoute, type SortieRouteDeps } from "./sortieRoute.js";
import { applyAutomaticAvailability, applyGuidanceAvailability } from "../availability/automatic.js";
import { readAvailabilityIntervals } from "../availability/availability.js";
import { clearMeterReading, replaceMeterReading } from "./meterReading.js";
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

const previewBody = writeBody.extend({
  sortieId: z.uuid().nullable(),
});

const observationBody = z.object({
  observedAt: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracyMeters: z.number().nullable(),
  sortieId: z.uuid().nullable().optional(),
});

const rangeQuery = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

const sortieParams = z.object({
  id: z.uuid(),
});

const commenceBody = z.object({
  guidance: z.boolean().optional(),
});

const stopPositionParams = z.object({
  id: z.uuid(),
  position: z.coerce.number().int().nonnegative(),
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

const meterBody = z.object({
  sortieId: z.uuid(),
  milesTraveled: z.number(),
  waitSeconds: z.number(),
  totalCents: z.number(),
  estimateCents: z.number(),
  remainingMeters: z.number(),
  overviewPath: z.array(coordinateSchema).optional(),
});

function guidanceRequested(body: unknown): boolean | "invalid" {
  if (body === undefined || body === null) {
    return false;
  }
  const parsed = commenceBody.safeParse(body);
  return parsed.success ? parsed.data.guidance === true : "invalid";
}

export function registerCalendarRoutes(
  app: FastifyInstance,
  deps: ScheduleDeps = defaultScheduleDeps,
  routeDeps: SortieRouteDeps = defaultSortieRouteDeps,
): void {
  async function onLead(user: Parameters<typeof applyAutomaticAvailability>[0]): Promise<void> {
    await applyAutomaticAvailability(user, "lead", deps.now());
  }

  async function onAvailable(user: Parameters<typeof applyAutomaticAvailability>[0], event: "commencement" | "conclusion"): Promise<void> {
    await applyAutomaticAvailability(user, event, deps.now());
  }

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

  app.get("/activity", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await readActivity(active.user));
  });

  app.put("/meter-reading", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = meterBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const { overviewPath, ...reading } = parsed.data;
    const result = await replaceMeterReading(
      active.user,
      overviewPath === undefined ? reading : { ...reading, overviewPath },
    );
    if (result === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    if (result === "no-driver") {
      return reply.code(409).send({ error: "no driver" });
    }
    if (result === "not-in-progress") {
      return reply.code(409).send({ error: "not in progress" });
    }
    return reply.send(result);
  });

  app.delete("/meter-reading", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const result = await clearMeterReading(active.user);
    if (result === "no-driver") {
      return reply.code(409).send({ error: "no driver" });
    }
    return reply.code(204).send();
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
    const availability = await readAvailabilityIntervals(active.user.id, from, to);
    return reply.send({ sorties: result, availability });
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
    await onLead(active.user);
    return reply.code(201).send(result);
  });

  app.post("/sorties/preview", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const preview = readPreview(request.body);
    if (!preview) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await previewSortie(active.user, preview.input, preview.sortieId, deps);
    if (result === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    if (result === "no-driver") {
      return reply.code(409).send({ error: "no driver" });
    }
    if (result === "no-location") {
      return reply.code(409).send({ error: "no location" });
    }
    return reply.send(result);
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
    await onLead(active.user);
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
    const guidance = guidanceRequested(request.body);
    if (guidance === "invalid") {
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
    if (guidance) {
      await applyGuidanceAvailability(active.user, deps.now());
    } else {
      await onAvailable(active.user, "commencement");
    }
    return reply.send(result);
  });

  app.post("/sorties/:id/complete", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = sortieParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await completeSortie(active.user, params.data.id, deps);
    if (result === "not-found") {
      return reply.code(404).send({ error: "not found" });
    }
    if (result === "not-commenced") {
      return reply.code(409).send({ error: "not commenced" });
    }
    await onAvailable(active.user, "conclusion");
    return reply.send(result);
  });

  app.post("/sorties/:id/stops/:position/arrive", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = stopPositionParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await assertStopArrival(active.user, params.data.id, params.data.position, deps);
    if (result === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    if (result === "not-found") {
      return reply.code(404).send({ error: "not found" });
    }
    if (result === "not-commenced") {
      return reply.code(409).send({ error: "not commenced" });
    }
    return reply.send(result);
  });

  app.post("/sorties/:id/stops/:position/extend-wait", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = stopPositionParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await extendStopWait(active.user, params.data.id, params.data.position, deps);
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
    await onLead(active.user);
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

function readPreview(body: unknown): { input: SortieInput; sortieId: string | null } | null {
  const parsed = previewBody.safeParse(body);
  if (!parsed.success) {
    return null;
  }
  const input = readWrite(parsed.data);
  if (!input) {
    return null;
  }
  return { input, sortieId: parsed.data.sortieId };
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
    sortieId: parsed.data.sortieId ?? null,
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
