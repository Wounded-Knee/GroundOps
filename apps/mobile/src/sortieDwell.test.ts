import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SortieStop } from "@groundops/contracts";
import {
  bumpStopWaitMinutes,
  countdownRemainingSeconds,
  extendWaitEndsAt,
  hasLaterStop,
  isFinalStop,
  shouldCompleteOnLeave,
  waitEndsAtFromStop,
  waitExtendMs,
} from "./sortieDwell";

const stop = (waitMinutes: number): SortieStop => ({
  label: "Stop",
  latitude: 40,
  longitude: -74,
  waitMinutes,
  passenger: true,
  actualArrivedAt: null,
  actualDepartedAt: null,
});

describe("sortieDwell", () => {
  it("starts waitEndsAt from authored wait minutes", () => {
    assert.equal(waitEndsAtFromStop(3, 1_000), 1_000 + 3 * waitExtendMs);
    assert.equal(waitEndsAtFromStop(0, 1_000), 1_000);
  });

  it("extends waitEndsAt by one minute from the later of end or now", () => {
    assert.equal(extendWaitEndsAt(5_000, 1_000), 5_000 + waitExtendMs);
    assert.equal(extendWaitEndsAt(1_000, 5_000), 5_000 + waitExtendMs);
  });

  it("countdown reaching zero does not imply advance — extend path bumps minutes", () => {
    const now = 10_000;
    const ended = waitEndsAtFromStop(0, now);
    assert.equal(countdownRemainingSeconds(ended, now), 0);
    const next = extendWaitEndsAt(ended, now);
    assert.equal(countdownRemainingSeconds(next, now), 60);
    const stops = bumpStopWaitMinutes([stop(0), stop(0)], 0);
    assert.equal(stops[0]?.waitMinutes, 1);
    assert.equal(hasLaterStop(stops, 0), true);
    assert.equal(isFinalStop(stops, 0), false);
    assert.equal(isFinalStop(stops, 1), true);
  });

  it("completes only when leaving the final stop with no onward destination", () => {
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: false,
        pendingNextLeg: false,
        outsideGeofence: true,
      }),
      true,
    );
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: false,
        pendingNextLeg: false,
        outsideGeofence: false,
      }),
      false,
    );
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: false,
        hasLaterStop: true,
        pendingNextLeg: false,
        outsideGeofence: true,
      }),
      false,
    );
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: true,
        pendingNextLeg: true,
        outsideGeofence: true,
      }),
      false,
    );
  });
});
