import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeThrobCount } from "./visualAlertThrob.js";

describe("VisualAlert throb", () => {
  it("normalizes throb counts", () => {
    assert.equal(normalizeThrobCount(5), 5);
    assert.equal(normalizeThrobCount(5.9), 5);
    assert.equal(normalizeThrobCount(0), 0);
    assert.equal(normalizeThrobCount(-3), 0);
    assert.equal(normalizeThrobCount(Number.NaN), 0);
  });
});
