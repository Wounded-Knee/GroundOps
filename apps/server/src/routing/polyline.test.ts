import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodePolyline } from "./polyline.js";

describe("decodePolyline", () => {
  it("decodes the standard Google sample into coordinates", () => {
    const coordinates = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    assert.equal(coordinates.length, 3);
    assert.ok(close(coordinates[0]?.latitude, 38.5));
    assert.ok(close(coordinates[0]?.longitude, -120.2));
    assert.ok(close(coordinates[1]?.latitude, 40.7));
    assert.ok(close(coordinates[1]?.longitude, -120.95));
    assert.ok(close(coordinates[2]?.latitude, 43.252));
    assert.ok(close(coordinates[2]?.longitude, -126.453));
  });
});

function close(actual: number | undefined, expected: number): boolean {
  return actual !== undefined && Math.abs(actual - expected) < 1e-4;
}
