import type { DrivingRoute, GeoCoordinate, PlaceSuggestion } from "@groundops/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendDomainResult } from "../http/result.js";
import { coordinateSchema } from "../http/schemas.js";

const placeSuggestionsBody = z.object({
  query: z.string(),
  bias: coordinateSchema.nullable().optional(),
});

const drivingRouteBody = z.object({
  origin: coordinateSchema,
  destination: coordinateSchema,
});

export type RoutingDeps = {
  suggestPlaces: (query: string, bias: GeoCoordinate | null) => Promise<PlaceSuggestion[] | "failed">;
  computeDrivingRoute: (
    origin: GeoCoordinate,
    destination: GeoCoordinate,
  ) => Promise<DrivingRoute | "no-route" | "failed">;
  lookupAddress: (position: GeoCoordinate) => Promise<string | null>;
};

export function registerRoutingRoutes(app: FastifyInstance, deps: RoutingDeps): void {
  app.post("/place-suggestions", async (request, reply) => {
    if (!request.session) {
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
      return sendDomainResult(reply, suggestions);
    }
    return reply.send({ suggestions });
  });

  app.post("/driving-routes", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = drivingRouteBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }

    const route = await deps.computeDrivingRoute(parsed.data.origin, parsed.data.destination);
    if (typeof route === "string") {
      return sendDomainResult(reply, route);
    }
    return reply.send({ route });
  });

  app.post("/reverse-geocode", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = coordinateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }

    const address = await deps.lookupAddress(parsed.data);
    if (address === null || address.trim().length === 0) {
      return sendDomainResult(reply, "failed");
    }
    return reply.send({ address: address.trim() });
  });
}
