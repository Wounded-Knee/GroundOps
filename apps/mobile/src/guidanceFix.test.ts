import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arrivalMeters } from "./guidance.js";
import { arrivedFixChoice, guidingSortieFixChoice, insideArrival } from "./guidanceFix.js";
import { emptyArrivalDwell } from "./sortieDwell.js";

const fix = { latitude: 40, longitude: -74 };

describe("guidance fix transition", () => {
  it("starts the next leg when a later stop is left beyond the resume distance", () => {
    assert.equal(
      arrivedFixChoice({
        distanceToStopMeters: 80,
        resumeTravelMeters: 40,
        hasLaterStop: true,
        pendingNextLeg: false,
        isFinal: false,
        stationaryDwellMet: false,
      }),
      "start-next-leg",
    );
  });

  it("stays while the resume distance has not been crossed", () => {
    assert.equal(
      arrivedFixChoice({
        distanceToStopMeters: 10,
        resumeTravelMeters: 40,
        hasLaterStop: true,
        pendingNextLeg: false,
        isFinal: false,
        stationaryDwellMet: false,
      }),
      "stay",
    );
  });

  it("ends guidance when a final stop is left after the dwell is met", () => {
    assert.equal(
      arrivedFixChoice({
        distanceToStopMeters: arrivalMeters + 1,
        resumeTravelMeters: 0,
        hasLaterStop: false,
        pendingNextLeg: false,
        isFinal: true,
        stationaryDwellMet: true,
      }),
      "end-guidance",
    );
  });

  it("holds a final guiding stop inside the arrival ring until the dwell is satisfied", () => {
    const held = guidingSortieFixChoice({
      inside: true,
      finalLeg: true,
      dwell: emptyArrivalDwell(),
      fix,
      nowMs: 1_000,
    });
    assert.equal(held.action, "hold");
    assert.equal(held.dwell.satisfied, false);

    const entered = guidingSortieFixChoice({
      inside: true,
      finalLeg: true,
      dwell: { anchor: fix, startedAtMs: 0, satisfied: true },
      fix,
      nowMs: 40_000,
    });
    assert.equal(entered.action, "enter-stop");
  });

  it("enters an earlier stop as soon as the fix is inside the ring", () => {
    assert.equal(
      guidingSortieFixChoice({
        inside: true,
        finalLeg: false,
        dwell: emptyArrivalDwell(),
        fix,
        nowMs: 0,
      }).action,
      "enter-stop",
    );
    assert.equal(insideArrival(arrivalMeters), true);
    assert.equal(insideArrival(arrivalMeters + 1), false);
    assert.equal(insideArrival(null), false);
  });
});
