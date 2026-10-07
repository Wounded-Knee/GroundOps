import type { DrivingRoute, GeoCoordinate, PlaceSuggestion } from "@groundops/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ActiveSession } from "../identity/sessions.js";

const coordinateSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
});

const placeSuggestionsBody = z.object({
  query: z.string(),
  bias: coordinateSchema.nullable().optional(),
});

const drivingRouteBody = z.object({
  origin: coordinateSchema,
  destination: coordinateSchema,
});

const reverseGeocodeBody = coordinateSchema;

export type RoutingDeps = {
  findSession: (authorization: string | undefined) => Promise<ActiveSession | null>;
  suggestPlaces: (query: string, bias: GeoCoordinate | null) => Promise<PlaceSuggestion[] | "failed">;
  computeDrivingRoute: (
    origin: GeoCoordinate,
    destination: GeoCoordinate,
  ) => Promise<DrivingRoute | "no-route" | "failed">;
  lookupAddress: (position: GeoCoordinate) => Promise<string | null>;
};

export function registerRoutingRoutes(app: FastifyInstance, deps: RoutingDeps): void {
  app.post("/place-suggestions", async (request, reply) => {
    const session = await deps.findSession(oneHeader(request.headers.authorization));
    if (!session) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = placeSuggestionsBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }

    const query = parsed.data.query.trim();
    if (query.length === 0) {
      return reply.send({ suggestions: [] });
    }

    const suggestions = await deps.suggestPlaces(query, parsed.data.bias ?? null);
    if (suggestions === "failed") {
      return reply.code(502).send({ error: "provider failed" });
    }
    return reply.send({ suggestions });
  });

  app.post("/driving-routes", async (request, reply) => {
    const session = await deps.findSession(oneHeader(request.headers.authorization));
    if (!session) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = drivingRouteBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }

    const route = await deps.computeDrivingRoute(parsed.data.origin, parsed.data.destination);
    if (route === "failed") {
      return reply.code(502).send({ error: "provider failed" });
    }
    if (route === "no-route") {
      return reply.code(422).send({ error: "no route" });
    }
    return reply.send({ route });
  });

  app.post("/reverse-geocode", async (request, reply) => {
    const session = await deps.findSession(oneHeader(request.headers.authorization));
    if (!session) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = reverseGeocodeBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }

    const address = await deps.lookupAddress(parsed.data);
    if (address === null || address.trim().length === 0) {
      return reply.code(502).send({ error: "provider failed" });
    }
    return reply.send({ address: address.trim() });
  });
}

function oneHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
