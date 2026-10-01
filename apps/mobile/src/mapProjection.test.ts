import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { geoToScreen, screenToGeo, viewportFromCamera } from "./mapProjection.js";

describe("mapProjection", () => {
  it("round-trips geo coordinates through screen space", () => {
    const viewport = {
      latitude: 40.75,
      longitude: -73.98,
      latitudeDelta: 0.04,
      longitudeDelta: 0.05,
    };
    const size = { width: 400, height: 800 };
    const point = { latitude: 40.74, longitude: -73.97 };
    const screen = geoToScreen(point, viewport, size);
    const back = screenToGeo(screen, viewport, size);
    assert.ok(Math.abs(back.latitude - point.latitude) < 1e-9);
    assert.ok(Math.abs(back.longitude - point.longitude) < 1e-9);
  });

  it("places the viewport center at the middle of the map", () => {
    const viewport = {
      latitude: 10,
      longitude: 20,
      latitudeDelta: 2,
      longitudeDelta: 4,
    };
    const size = { width: 200, height: 100 };
    assert.deepEqual(geoToScreen({ latitude: 10, longitude: 20 }, viewport, size), {
      x: 100,
      y: 50,
    });
  });

  it("builds an approximate viewport from camera zoom", () => {
    const viewport = viewportFromCamera({ latitude: 1, longitude: 2, zoom: 8 });
    assert.equal(viewport.latitude, 1);
    assert.equal(viewport.longitude, 2);
    assert.equal(viewport.longitudeDelta, 360 / 2 ** 8);
    assert.equal(viewport.latitudeDelta, viewport.longitudeDelta);
  });
});
