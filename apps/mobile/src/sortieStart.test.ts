import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coalescedEnd, coalescedStart } from "./sortieStart";

describe("coalescedStart / coalescedEnd", () => {
  it("prefers actuals when sealed", () => {
    assert.equal(
      coalescedStart({
        actualStart: "2026-09-02T14:20:00.000Z",
        scheduledStart: "2026-09-02T14:30:00.000Z",
      }),
      "2026-09-02T14:20:00.000Z",
    );
    assert.equal(
      coalescedEnd({
        actualEnd: "2026-09-02T16:00:00.000Z",
        scheduledEnd: "2026-09-02T16:30:00.000Z",
      }),
      "2026-09-02T16:00:00.000Z",
    );
  });

  it("falls back to scheduled when actuals are absent", () => {
    assert.equal(
      coalescedStart({
        actualStart: null,
        scheduledStart: "2026-09-02T14:30:00.000Z",
      }),
      "2026-09-02T14:30:00.000Z",
    );
    assert.equal(
      coalescedEnd({
        actualEnd: null,
        scheduledEnd: "2026-09-02T16:30:00.000Z",
      }),
      "2026-09-02T16:30:00.000Z",
    );
  });
});
