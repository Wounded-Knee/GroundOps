import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DrivingRoute, PlaceSuggestion } from "@groundops/contracts";
import Fastify from "fastify";
import type { ActiveSession } from "../identity/sessions.js";
import { registerRoutingRoutes, type RoutingDeps } from "./http.js";

const session: ActiveSession = {
  sessionId: "session",
  user: { id: "user", displayName: null, email: null },
};

const route: DrivingRoute = {
  distanceMeters: 100,
  durationSeconds: 30,
  path: [{ latitude: 1, longitude: 2 }],
  steps: [
    {
      instruction: "Head north",
      maneuver: "depart",
      distanceMeters: 100,
      durationSeconds: 30,
      path: [{ latitude: 1, longitude: 2 }],
    },
  ],
};

describe("routing http", () => {
  it("rejects a missing session", async () => {
    const app = appWith({
      findSession: async () => null,
      suggestPlaces: async () => [],
      computeDrivingRoute: async () => route,
      lookupAddress: async () => "Somewhere",
    });
    const suggestions = await app.inject({
      method: "POST",
      url: "/place-suggestions",
      payload: { query: "library" },
    });
    const driving = await app.inject({
      method: "POST",
      url: "/driving-routes",
      payload: {
        origin: { latitude: 1, longitude: 2 },
        destination: { latitude: 3, longitude: 4 },
      },
    });
    const reverse = await app.inject({
      method: "POST",
      url: "/reverse-geocode",
      payload: { latitude: 1, longitude: 2 },
    });
    assert.equal(suggestions.statusCode, 401);
    assert.equal(driving.statusCode, 401);
    assert.equal(reverse.statusCode, 401);
    await app.close();
  });

  it("returns no suggestions for an empty query and does not call the provider", async () => {
    let calls = 0;
    const app = appWith({
      findSession: async () => session,
      suggestPlaces: async () => {
        calls += 1;
        return [];
      },
      computeDrivingRoute: async () => "failed",
      lookupAddress: async () => null,
    });
    const response = await app.inject({
      method: "POST",
      url: "/place-suggestions",
      headers: { authorization: "Bearer token" },
      payload: { query: "  " },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { suggestions: [] });
    assert.equal(calls, 0);
    await app.close();
  });

  it("returns a driving route for a session", async () => {
    const app = appWith({
      findSession: async (authorization) => (authorization === "Bearer token" ? session : null),
      suggestPlaces: async () =>
        [{ label: "Library", name: "Library", detail: "", latitude: 1, longitude: 2 }] satisfies PlaceSuggestion[],
      computeDrivingRoute: async () => route,
      lookupAddress: async () => "1 Main St",
    });
    const response = await app.inject({
      method: "POST",
      url: "/driving-routes",
      headers: { authorization: "Bearer token" },
      payload: {
        origin: { latitude: 1, longitude: 2 },
        destination: { latitude: 3, longitude: 4 },
      },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { route: DrivingRoute };
    assert.equal(body.route.steps[0]?.instruction, "Head north");
    assert.equal(JSON.stringify(body).includes("encodedPolyline"), false);
    assert.equal(JSON.stringify(body).includes("placeId"), false);
    const reverse = await app.inject({
      method: "POST",
      url: "/reverse-geocode",
      headers: { authorization: "Bearer token" },
      payload: { latitude: 1, longitude: 2 },
    });
    assert.equal(reverse.statusCode, 200);
    assert.deepEqual(reverse.json(), { address: "1 Main St" });
    await app.close();
  });

  it("rejects a route the provider cannot produce", async () => {
    const app = appWith({
      findSession: async () => session,
      suggestPlaces: async () => "failed",
      computeDrivingRoute: async () => "no-route",
      lookupAddress: async () => null,
    });
    const response = await app.inject({
      method: "POST",
      url: "/driving-routes",
      headers: { authorization: "Bearer token" },
      payload: {
        origin: { latitude: 1, longitude: 2 },
        destination: { latitude: 3, longitude: 4 },
      },
    });
    assert.equal(response.statusCode, 422);
    await app.close();
  });
});

function appWith(deps: RoutingDeps) {
  const app = Fastify();
  registerRoutingRoutes(app, deps);
  return app;
}
