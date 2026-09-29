import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDriveDuration, computeDrivingRoute, lookupAddress, mapGoogleRoute, mapManeuver, suggestPlaces } from "./google.js";

const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

describe("mapManeuver", () => {
  it("maps Google maneuver names onto the platform set", () => {
    assert.equal(mapManeuver("DEPART"), "depart");
    assert.equal(mapManeuver("TURN_LEFT"), "turn-left");
    assert.equal(mapManeuver("TURN_SHARP_RIGHT"), "sharp-right");
    assert.equal(mapManeuver("UTURN_LEFT"), "u-turn");
    assert.equal(mapManeuver("ROUNDABOUT_RIGHT"), "roundabout");
    assert.equal(mapManeuver("FORK_LEFT"), "fork-left");
    assert.equal(mapManeuver("RAMP_RIGHT"), "ramp-right");
    assert.equal(mapManeuver("NAME_CHANGE"), "straight");
    assert.equal(mapManeuver("FERRY"), "straight");
    assert.equal(mapManeuver("NOT_A_MANEUVER"), "straight");
  });
});

describe("mapGoogleRoute", () => {
  it("returns platform coordinates and drops Google encodings", () => {
    const route = mapGoogleRoute({
      routes: [
        {
          distanceMeters: 300,
          duration: "90s",
          polyline: { encodedPolyline: encoded },
          legs: [
            {
              steps: [
                {
                  distanceMeters: 100,
                  staticDuration: "30s",
                  navigationInstruction: { maneuver: "DEPART", instructions: "Head north" },
                  startLocation: { latLng: { latitude: 1, longitude: 2 } },
                  endLocation: { latLng: { latitude: 1.001, longitude: 2 } },
                },
                {
                  distanceMeters: 200,
                  staticDuration: "60s",
                  polyline: { encodedPolyline: encoded },
                  navigationInstruction: { maneuver: "TURN_LEFT", instructions: "<b>Turn left</b>" },
                },
              ],
            },
          ],
        },
      ],
    });

    assert.notEqual(route, "no-route");
    if (route === "no-route") {
      return;
    }
    assert.equal(route.distanceMeters, 300);
    assert.equal(route.durationSeconds, 90);
    assert.equal(route.steps[0]?.maneuver, "depart");
    assert.equal(route.steps[0]?.durationSeconds, 30);
    assert.equal(route.steps[1]?.maneuver, "turn-left");
    assert.equal(route.steps[1]?.instruction, "Turn left");
    assert.equal(route.steps[1]?.durationSeconds, 60);
    assert.ok((route.path[0]?.latitude ?? 0) > 38);
    const serialized = JSON.stringify(route);
    assert.equal(serialized.includes("encodedPolyline"), false);
    assert.equal(serialized.includes(encoded), false);
    assert.equal(serialized.includes("placeId"), false);
  });

  it("marks an arrival instruction as arrive", () => {
    const route = mapGoogleRoute({
      routes: [
        {
          duration: "10s",
          distanceMeters: 20,
          polyline: { encodedPolyline: encoded },
          legs: [
            {
              steps: [
                {
                  distanceMeters: 20,
                  staticDuration: "10s",
                  navigationInstruction: { maneuver: "STRAIGHT", instructions: "Arrive at the destination" },
                  startLocation: { latLng: { latitude: 1, longitude: 2 } },
                  endLocation: { latLng: { latitude: 1.001, longitude: 2 } },
                },
              ],
            },
          ],
        },
      ],
    });
    assert.notEqual(route, "no-route");
    if (route === "no-route") {
      return;
    }
    assert.equal(route.steps[0]?.maneuver, "arrive");
  });

  it("rejects a payload with no driving route", () => {
    assert.equal(mapGoogleRoute({ routes: [] }), "no-route");
    assert.equal(mapGoogleRoute({}), "no-route");
  });
});

describe("suggestPlaces", () => {
  it("does not call Google for an empty query", async () => {
    let calls = 0;
    const result = await suggestPlaces("   ", null, {
      apiKey: "test-key",
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });
    assert.deepEqual(result, []);
    assert.equal(calls, 0);
  });

  it("does not call Google when the server key is missing", async () => {
    let calls = 0;
    const previous = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    try {
      const result = await suggestPlaces("library", null, {
        fetch: async () => {
          calls += 1;
          return Response.json({});
        },
      });
      assert.equal(result, "failed");
      assert.equal(calls, 0);
    } finally {
      if (previous === undefined) {
        delete process.env.GOOGLE_MAPS_API_KEY;
      } else {
        process.env.GOOGLE_MAPS_API_KEY = previous;
      }
    }
  });

  it("returns labels and coordinates and drops the place id", async () => {
    const result = await suggestPlaces("library", { latitude: 40, longitude: -75 }, {
      apiKey: "test-key",
      fetch: async (url, init) => {
        if (url.endsWith(":autocomplete")) {
          const body = JSON.parse(String(init?.body)) as { locationBias?: unknown };
          assert.ok(body.locationBias);
          return Response.json({
            suggestions: [
              {
                placePrediction: {
                  placeId: "secret-place",
                  text: { text: "Denny's, 123 Main St, Springfield, IL, USA" },
                  structuredFormat: {
                    mainText: { text: "Denny's" },
                    secondaryText: { text: "123 Main St, Springfield, IL, USA" },
                  },
                },
              },
            ],
          });
        }
        assert.equal(url.includes("secret-place"), true);
        return Response.json({
          location: { latitude: 40.1, longitude: -75.1 },
          id: "secret-place",
        });
      },
    });

    assert.deepEqual(result, [
      {
        label: "Denny's, 123 Main St, Springfield, IL, USA",
        name: "Denny's",
        detail: "123 Main St, Springfield, IL, USA",
        latitude: 40.1,
        longitude: -75.1,
      },
    ]);
    assert.equal(JSON.stringify(result).includes("secret-place"), false);
  });

  it("keeps the placename in the label when the prediction text is only the postal address", async () => {
    const result = await suggestPlaces("denny", null, {
      apiKey: "test-key",
      fetch: async (url) => {
        if (url.endsWith(":autocomplete")) {
          return Response.json({
            suggestions: [
              {
                placePrediction: {
                  placeId: "diner",
                  text: { text: "123 Main St, Springfield, IL, USA" },
                  structuredFormat: {
                    mainText: { text: "Denny's" },
                    secondaryText: { text: "123 Main St, Springfield, IL, USA" },
                  },
                },
              },
            ],
          });
        }
        return Response.json({ location: { latitude: 39.8, longitude: -89.6 } });
      },
    });

    assert.deepEqual(result, [
      {
        label: "Denny's, 123 Main St, Springfield, IL, USA",
        name: "Denny's",
        detail: "123 Main St, Springfield, IL, USA",
        latitude: 39.8,
        longitude: -89.6,
      },
    ]);
  });
});

describe("computeDrivingRoute", () => {
  it("returns no-route when Google has no driving route", async () => {
    const result = await computeDrivingRoute(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 1 },
      {
        apiKey: "test-key",
        fetch: async () => Response.json({ routes: [] }),
      },
    );
    assert.equal(result, "no-route");
  });

  it("returns failed when the provider responds with an error", async () => {
    const result = await computeDrivingRoute(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 1 },
      {
        apiKey: "test-key",
        fetch: async () => new Response("nope", { status: 500 }),
      },
    );
    assert.equal(result, "failed");
  });
});

describe("computeDriveDuration", () => {
  it("asks for traffic at the departure time and returns that duration", async () => {
    let sent: { body: Record<string, unknown>; fieldMask: string } | null = null;
    const duration = await computeDriveDuration(
      { latitude: 1, longitude: 2 },
      { latitude: 3, longitude: 4 },
      [{ latitude: 5, longitude: 6 }],
      new Date("2026-09-02T14:30:00.000Z"),
      {
        apiKey: "test-key",
        fetch: async (_url, init) => {
          const headers = init.headers;
          const fieldMask =
            headers instanceof Headers
              ? headers.get("X-Goog-FieldMask")
              : typeof headers === "object" && headers !== null && "X-Goog-FieldMask" in headers
                ? String(headers["X-Goog-FieldMask"])
                : "";
          sent = {
            body: JSON.parse(String(init.body)) as Record<string, unknown>,
            fieldMask: fieldMask ?? "",
          };
          return Response.json({ routes: [{ duration: "120s" }] });
        },
      },
    );
    assert.equal(duration, 120);
    assert.ok(sent);
    if (!sent) {
      return;
    }
    const request: { body: Record<string, unknown>; fieldMask: string } = sent;
    assert.equal(request.fieldMask, "routes.duration");
    assert.equal(request.body.routingPreference, "TRAFFIC_AWARE");
    assert.equal(request.body.departureTime, "2026-09-02T14:30:00.000Z");
    assert.equal(request.body.travelMode, "DRIVE");
    assert.equal(Array.isArray(request.body.intermediates) ? request.body.intermediates.length : 0, 1);
  });
});

describe("lookupAddress", () => {
  it("returns the formatted address for a coordinate", async () => {
    let requested = "";
    const address = await lookupAddress(
      { latitude: 40.7128, longitude: -74.006 },
      {
        apiKey: "test-key",
        fetch: async (url) => {
          requested = String(url);
          return Response.json({
            status: "OK",
            results: [{ formatted_address: "City Hall, New York, NY, USA" }],
          });
        },
      },
    );
    assert.equal(address, "City Hall, New York, NY, USA");
    assert.match(requested, /latlng=40\.7128(%2C|,)-74\.006/);
    assert.match(requested, /key=test-key/);
  });
});
