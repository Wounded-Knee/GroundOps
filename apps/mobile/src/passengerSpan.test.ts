import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyPassengerToggle, passengerSpan, repairPassengerSpan } from "./passengerSpan.js";

describe("passenger span", () => {
  it("starts a span on the first stop turned on", () => {
    assert.deepEqual(applyPassengerToggle([false, false, false], 1), [false, true, false]);
    assert.deepEqual(passengerSpan([false, true, false]), { start: 1, end: 1 });
  });

  it("fills from the existing span through a stop turned on outside it", () => {
    assert.deepEqual(applyPassengerToggle([false, true, false, false], 3), [false, true, true, true]);
    assert.deepEqual(applyPassengerToggle([false, false, true, true], 0), [true, true, true, true]);
  });

  it("shrinks an endpoint and clears the span when the last stop turns off", () => {
    assert.deepEqual(applyPassengerToggle([false, true, true, true, false], 1), [false, false, true, true, false]);
    assert.deepEqual(applyPassengerToggle([false, true, true, true, false], 3), [false, true, true, false, false]);
    assert.deepEqual(applyPassengerToggle([false, true, false], 1), [false, false, false]);
    assert.equal(passengerSpan([false, false, false]), null);
  });

  it("leaves an interior passenger stop unchanged", () => {
    const flags = [false, true, true, true, false];
    assert.deepEqual(applyPassengerToggle(flags, 2), flags);
  });

  it("fills a gap from the first passenger stop through the last", () => {
    assert.deepEqual(repairPassengerSpan([true, false, true]), [true, true, true]);
    assert.deepEqual(repairPassengerSpan([false, true, false, true, false]), [false, true, true, true, false]);
    assert.deepEqual(repairPassengerSpan([false, false]), [false, false]);
    assert.deepEqual(repairPassengerSpan([]), []);
  });
});
