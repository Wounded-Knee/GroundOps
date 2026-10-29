import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { indexAtOffset, moveStop, rowTranslate, type StopDrag } from "./sortieDrag.js";

describe("sortie drag", () => {
  it("moves a stop and leaves an unchanged range alone", () => {
    const stops = ["a", "b", "c"];
    assert.deepEqual(moveStop(stops, 0, 2), ["b", "c", "a"]);
    assert.equal(moveStop(stops, 1, 1), stops);
    assert.equal(moveStop(stops, -1, 0), stops);
  });

  it("picks the row under the dragged center", () => {
    assert.equal(indexAtOffset([], 0, 0, 1), 0);
    assert.equal(indexAtOffset([80, 80, 80], 0, 0, 3), 0);
    assert.equal(indexAtOffset([80, 80, 80], 0, 100, 3), 1);
    assert.equal(indexAtOffset([80, 80, 80], 2, -100, 3), 1);
    assert.equal(indexAtOffset([], 0, 200, 3), 2);
  });

  it("shifts the rows the dragged stop passes", () => {
    const drag: StopDrag = { index: 0, dy: 40, target: 2 };
    assert.equal(rowTranslate(0, drag, [80, 80, 80]), 40);
    assert.equal(rowTranslate(1, drag, [80, 80, 80]), -80);
    assert.equal(rowTranslate(2, drag, [80, 80, 80]), -80);
    assert.equal(rowTranslate(1, null, []), 0);
    const upward: StopDrag = { index: 2, dy: -20, target: 0 };
    assert.equal(rowTranslate(0, upward, []), 64);
    assert.equal(rowTranslate(2, upward, []), -20);
  });
});
