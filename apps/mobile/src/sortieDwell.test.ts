import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SortieStop } from "@groundops/contracts";
import {
  arrivalDwellMs,
  bumpStopWaitMinutes,
  countdownRemainingSeconds,
  emptyArrivalDwell,
  extendWaitEndsAt,
  hasLaterStop,
  isFinalStop,
  noteArrivalDwell,
  settleArrivalDwell,
  shouldCompleteOnLeave,
  waitEndsAtFromStop,
  waitExtendMs,
} from "./sortieDwell";

const here = { latitude: 40, longitude: -74 };
/** About 2 m north of `here`, inside the 5 m stationary radius. */
const parked = { latitude: 40.00002, longitude: -74 };
/** About 33 m north of `here`, outside the stationary radius. */
const rolled = { latitude: 40.0003, longitude: -74 };

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
        stationaryDwellMet: true,
      }),
      true,
    );
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: false,
        pendingNextLeg: false,
        outsideGeofence: false,
        stationaryDwellMet: true,
      }),
      false,
    );
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: false,
        pendingNextLeg: false,
        outsideGeofence: true,
        stationaryDwellMet: false,
      }),
      false,
    );
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: false,
        hasLaterStop: true,
        pendingNextLeg: false,
        outsideGeofence: true,
        stationaryDwellMet: true,
      }),
      false,
    );
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: true,
        pendingNextLeg: true,
        outsideGeofence: true,
        stationaryDwellMet: true,
      }),
      false,
    );
  });

  it("does not treat a pass-through as a stationary dwell", () => {
    const entered = noteArrivalDwell(emptyArrivalDwell(), {
      inside: true,
      fix: here,
      nowMs: 0,
      stationaryMeters: 5,
    });
    assert.equal(entered.satisfied, false);
    const passed = noteArrivalDwell(entered, {
      inside: true,
      fix: rolled,
      nowMs: 1_000,
      stationaryMeters: 5,
    });
    assert.equal(passed.satisfied, false);
    assert.equal(passed.startedAtMs, 1_000);
    const settled = settleArrivalDwell(passed, 1_000 + arrivalDwellMs - 1);
    assert.equal(settled.satisfied, false);
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: false,
        pendingNextLeg: false,
        outsideGeofence: true,
        stationaryDwellMet: settled.satisfied,
      }),
      false,
    );
  });

  it("clears an unsatisfied dwell when the fix leaves the destination", () => {
    const entered = noteArrivalDwell(emptyArrivalDwell(), {
      inside: true,
      fix: here,
      nowMs: 0,
      stationaryMeters: 5,
    });
    const left = noteArrivalDwell(entered, {
      inside: false,
      fix: rolled,
      nowMs: 10_000,
      stationaryMeters: 5,
    });
    assert.equal(left.anchor, null);
    assert.equal(left.startedAtMs, null);
    assert.equal(left.satisfied, false);
  });

  it("restarts the clock when the fix moves beyond the stationary radius", () => {
    const entered = noteArrivalDwell(emptyArrivalDwell(), {
      inside: true,
      fix: here,
      nowMs: 0,
      stationaryMeters: 5,
    });
    const moved = noteArrivalDwell(entered, {
      inside: true,
      fix: rolled,
      nowMs: 10_000,
      stationaryMeters: 5,
    });
    assert.equal(settleArrivalDwell(moved, arrivalDwellMs).satisfied, false);
    assert.equal(settleArrivalDwell(moved, 10_000 + arrivalDwellMs).satisfied, true);
  });

  it("satisfies after 30 seconds parked and completes only on a later exit", () => {
    const entered = noteArrivalDwell(emptyArrivalDwell(), {
      inside: true,
      fix: here,
      nowMs: 1_000,
      stationaryMeters: 5,
    });
    const held = noteArrivalDwell(entered, {
      inside: true,
      fix: parked,
      nowMs: 10_000,
      stationaryMeters: 5,
    });
    assert.equal(held.startedAtMs, 1_000);
    assert.equal(held.anchor, here);
    assert.equal(held.satisfied, false);
    assert.equal(settleArrivalDwell(held, 1_000 + arrivalDwellMs - 1).satisfied, false);
    const ready = settleArrivalDwell(held, 1_000 + arrivalDwellMs);
    assert.equal(ready.satisfied, true);
    const stillThere = noteArrivalDwell(ready, {
      inside: false,
      fix: rolled,
      nowMs: 40_000,
      stationaryMeters: 5,
    });
    assert.equal(stillThere.satisfied, true);
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: false,
        pendingNextLeg: false,
        outsideGeofence: false,
        stationaryDwellMet: ready.satisfied,
      }),
      false,
    );
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: false,
        pendingNextLeg: false,
        outsideGeofence: true,
        stationaryDwellMet: ready.satisfied,
      }),
      true,
    );
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: true,
        pendingNextLeg: false,
        outsideGeofence: true,
        stationaryDwellMet: ready.satisfied,
      }),
      false,
    );
    assert.equal(
      shouldCompleteOnLeave({
        isFinal: true,
        hasLaterStop: false,
        pendingNextLeg: true,
        outsideGeofence: true,
        stationaryDwellMet: ready.satisfied,
      }),
      false,
    );
  });
});
