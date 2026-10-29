import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendDomainResult } from "../http/result.js";
import { coordinateSchema, stopSchema, tariffSchema } from "../http/schemas.js";
import { registerRequestSession } from "../http/session.js";
import { ensureDriver } from "../identity/driver.js";
import {
  authorWithAvailability,
  commenceWithAvailability,
  completeWithAvailability,
  driveSortieWithAvailability,
  extendWaitWithAvailability,
  loadCalendar,
  recordWithAvailability,
  reviseWithAvailability,
} from "./application.js";
import { previewSortie } from "./authoring.js";
import { assertStopArrival } from "./lifecycle.js";
import { readActivity } from "./activity.js";
import { clearMeterReading, replaceMeterReading } from "./meterReading.js";
import type { SortieRouteDeps } from "./sortieRoute.js";
import { defaultScheduleDeps, type ObservationInput, type ScheduleDeps, type SortieInput } from "./support.js";
import { readTariff, replaceTariff } from "./tariff.js";

const writeBody = z.object({
  id: z.uuid().optional(),
  label: z.string(),
  arrivalAt: z.string().nullable(),
  passengerName: z.string().nullable(),
  passengerPhone: z.string().nullable(),
  stops: z.array(stopSchema),
});

const previewBody = writeBody.extend({
  sortieId: z.uuid().nullable(),
});

const observationBody = z.object({
  id: z.uuid().optional(),
  observedAt: z.string(),
  latitude: coordinateSchema.shape.latitude,
  longitude: coordinateSchema.shape.longitude,
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

const sortieRouteBody = z.object({
  origin: coordinateSchema,
  firstStopPosition: z.number().int().nonnegative(),
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

const failedRoute: SortieRouteDeps = {
  computeDrivingRoute: async () => "failed",
};

export function registerCalendarRoutes(
  app: FastifyInstance,
  deps: ScheduleDeps = defaultScheduleDeps,
  routeDeps: SortieRouteDeps = failedRoute,
): void {
  registerRequestSession(app);

  app.post("/drivers/current", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await ensureDriver(request.session.user));
  });

  app.get("/fare-rates", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const tariff = await readTariff(request.session.user);
    if (tariff === "no-driver") {
      return sendDomainResult(reply, tariff);
    }
    return reply.send(tariff);
  });

  app.put("/fare-rates", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = tariffSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await replaceTariff(request.session.user, parsed.data);
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send(result);
  });

  app.get("/activity", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await readActivity(request.session.user, deps));
  });

  app.put("/meter-reading", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = meterBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const { overviewPath, ...reading } = parsed.data;
    const result = await replaceMeterReading(
      request.session.user,
      overviewPath === undefined ? reading : { ...reading, overviewPath },
    );
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send(result);
  });

  app.delete("/meter-reading", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const result = await clearMeterReading(request.session.user);
    if (result === "no-driver") {
      return sendDomainResult(reply, result);
    }
    return reply.code(204).send();
  });

  app.get("/calendar", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = rangeQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await loadCalendar(
      request.session.user,
      new Date(parsed.data.from),
      new Date(parsed.data.to),
      deps,
    );
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send(result);
  });

  app.post("/sorties", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const input = readWrite(request.body);
    if (!input) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await authorWithAvailability(request.session.user, input, deps);
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.code(201).send(result);
  });

  app.post("/sorties/preview", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const preview = readPreview(request.body);
    if (!preview) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await previewSortie(request.session.user, preview.input, preview.sortieId, deps);
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send(result);
  });

  app.patch("/sorties/:id", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = sortieParams.safeParse(request.params);
    const input = readWrite(request.body);
    if (!params.success || !input) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await reviseWithAvailability(request.session.user, params.data.id, input, deps);
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send(result);
  });

  app.post("/sorties/:id/commence", async (request, reply) => {
    if (!request.session) {
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
    const result = await commenceWithAvailability(request.session.user, params.data.id, guidance, deps);
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send(result);
  });

  app.post("/sorties/:id/complete", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = sortieParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await completeWithAvailability(request.session.user, params.data.id, deps);
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send(result);
  });

  app.post("/sorties/:id/stops/:position/arrive", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = stopPositionParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await assertStopArrival(request.session.user, params.data.id, params.data.position, deps);
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send(result);
  });

  app.post("/sorties/:id/stops/:position/extend-wait", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = stopPositionParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await extendWaitWithAvailability(request.session.user, params.data.id, params.data.position, deps);
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send(result);
  });

  app.post("/sorties/:id/driving-route", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = sortieParams.safeParse(request.params);
    const body = sortieRouteBody.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await driveSortieWithAvailability(
      request.session.user,
      params.data.id,
      body.data.origin,
      body.data.firstStopPosition,
      routeDeps,
      deps,
    );
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send({ route: result });
  });

  app.post("/location-observations", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const input = readObservation(request.body);
    if (!input) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const result = await recordWithAvailability(request.session.user, input, deps);
    if (result !== "ok") {
      return sendDomainResult(reply, result);
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
    id: parsed.data.id,
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
    id: parsed.data.id ?? null,
    observedAt,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    accuracyMeters: parsed.data.accuracyMeters,
    sortieId: parsed.data.sortieId ?? null,
  };
}
