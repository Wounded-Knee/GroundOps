import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alertEdges, normalizeThrobCount } from "./visualAlertThrob.js";

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
});
