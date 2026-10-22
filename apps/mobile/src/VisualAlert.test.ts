import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alertEdges, edgeFadeStops, normalizeThrobCount } from "./visualAlertThrob.js";

describe("VisualAlert throb", () => {
  it("normalizes throb counts", () => {
    assert.equal(normalizeThrobCount(5), 5);
    assert.equal(normalizeThrobCount(5.9), 5);
    assert.equal(normalizeThrobCount(0), 0);
    assert.equal(normalizeThrobCount(-3), 0);
    assert.equal(normalizeThrobCount(Number.NaN), 0);
  });

  it("selects turn-signal edges", () => {
    assert.deepEqual(alertEdges("left"), { top: true, bottom: true, left: true, right: false });
    assert.deepEqual(alertEdges("right"), { top: true, bottom: true, left: false, right: true });
    assert.deepEqual(alertEdges("all"), { top: true, bottom: true, left: true, right: true });
  });

  it("fades the rim quadratically from the outer edge", () => {
    const stops = edgeFadeStops("#FF3B30", 0.7);
    assert.equal(stops.length, 8);
    assert.equal(stops[0]?.position, 0);
    assert.equal(stops[7]?.position, 1);
    assert.equal(stops[0]?.r, 0xff);
    assert.equal(stops[0]?.g, 0x3b);
    assert.equal(stops[0]?.b, 0x30);
    assert.ok(stops[0] && Math.abs(stops[0].a - 0.7) < 1e-9);
    assert.equal(stops[7]?.a, 0);
    const midpoint = 1 - 4 / 7;
    assert.ok(stops[4] && Math.abs(stops[4].a - 0.7 * midpoint * midpoint) < 1e-9);
    assert.deepEqual(edgeFadeStops("#FF3B30", 0), []);
    assert.deepEqual(edgeFadeStops("red", 1), []);
  });
});
