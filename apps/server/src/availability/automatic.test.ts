import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeoCoordinate } from "@groundops/contracts";
import { availabilityForcingUnavailable, pointInGeofence } from "./automatic.js";

const square: GeoCoordinate[] = [
  { latitude: 0, longitude: 0 },
  { latitude: 0, longitude: 1 },
  { latitude: 1, longitude: 1 },
  { latitude: 1, longitude: 0 },
];

const inside: GeoCoordinate = { latitude: 0.5, longitude: 0.5 };
const outside: GeoCoordinate = { latitude: 2, longitude: 2 };
const boundary: GeoCoordinate = { latitude: 0, longitude: 0.5 };
const idle = {
  sortieInProgress: false,
  nextStartInMs: null,
  thresholdMinutes: 15,
  fix: null,
  geofence: [] as GeoCoordinate[],
};

describe("automatic availability", () => {
  it("treats a point inside the ring, on its boundary, and on a vertex as inside", () => {
    assert.equal(pointInGeofence(inside, square), true);
    assert.equal(pointInGeofence(boundary, square), true);
    assert.equal(pointInGeofence(square[0]!, square), true);
    assert.equal(pointInGeofence(outside, square), false);
    assert.equal(pointInGeofence({ latitude: 0.5, longitude: -0.1 }, square), false);
  });

  it("forces unavailable for a sortie in progress", () => {
    assert.equal(availabilityForcingUnavailable({ ...idle, sortieInProgress: true }), true);
  });

  it("forces unavailable only while the next start is inside the threshold", () => {
    assert.equal(availabilityForcingUnavailable({ ...idle, nextStartInMs: 14 * 60_000 }), true);
    assert.equal(availabilityForcingUnavailable({ ...idle, nextStartInMs: 0 }), true);
    assert.equal(availabilityForcingUnavailable({ ...idle, nextStartInMs: 15 * 60_000 }), false);
    assert.equal(availabilityForcingUnavailable({ ...idle, nextStartInMs: -60_000 }), false);
    assert.equal(availabilityForcingUnavailable({ ...idle, nextStartInMs: 60_000, thresholdMinutes: 0 }), false);
  });

  it("forces unavailable only when a fix is outside a real ring", () => {
    assert.equal(availabilityForcingUnavailable({ ...idle, fix: outside, geofence: square }), true);
    assert.equal(availabilityForcingUnavailable({ ...idle, fix: inside, geofence: square }), false);
    assert.equal(availabilityForcingUnavailable({ ...idle, fix: boundary, geofence: square }), false);
    assert.equal(availabilityForcingUnavailable({ ...idle, fix: outside, geofence: [] }), false);
    assert.equal(availabilityForcingUnavailable({ ...idle, fix: null, geofence: square }), false);
    assert.equal(
      availabilityForcingUnavailable({
        ...idle,
        fix: outside,
        geofence: square.slice(0, 2),
      }),
      false,
    );
  });
});
