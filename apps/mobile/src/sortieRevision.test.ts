import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SortieStop } from "@groundops/contracts";
import { activeStopAfterRevision, dwellStopAfterRevision, samePlaceOrder } from "./sortieRevision";

function stop(label: string, latitude = 40): SortieStop {
  return {
    label,
    latitude,
    longitude: -74,
    waitMinutes: 0,
    passenger: false,
    actualArrivedAt: null,
    actualDepartedAt: null,
  };
}

describe("activeStopAfterRevision", () => {
  it("aims at a waypoint inserted before the sole destination", () => {
    const destination = stop("Dock", 41);
    const waypoint = stop("Wharf", 40.5);
    const index = activeStopAfterRevision([destination], 0, [waypoint, destination]);
    assert.equal(index, 0);
    assert.equal([waypoint, destination][index]?.label, "Wharf");
  });

  it("aims at a waypoint inserted before the current destination after a passed stop", () => {
    const passed = stop("Alpha", 40);
    const destination = stop("Dock", 42);
    const waypoint = stop("Wharf", 41);
    const index = activeStopAfterRevision([passed, destination], 1, [passed, waypoint, destination]);
    assert.equal(index, 1);
    assert.equal([passed, waypoint, destination][index]?.label, "Wharf");
  });

  it("keeps the current destination when a waypoint is appended after it", () => {
    const destination = stop("Dock", 41);
    const later = stop("Yard", 43);
    assert.equal(activeStopAfterRevision([destination], 0, [destination, later]), 0);

    const passed = stop("Alpha", 40);
    assert.equal(activeStopAfterRevision([passed, destination], 1, [passed, destination, later]), 1);
  });

  it("does not rewind onto a visited stop when the passed prefix is reordered", () => {
    const alpha = stop("Alpha", 40);
    const beta = stop("Beta", 40.4);
    const destination = stop("Dock", 42);
    const index = activeStopAfterRevision([alpha, beta, destination], 2, [beta, alpha, destination]);
    assert.equal(index, 2);
    assert.equal([beta, alpha, destination][index]?.label, "Dock");
  });

  it("does not rewind onto a visited stop when a waypoint is inserted ahead of it", () => {
    const alpha = stop("Alpha", 40);
    const destination = stop("Dock", 42);
    const waypoint = stop("Wharf", 39);
    const next = [waypoint, alpha, destination];
    const index = activeStopAfterRevision([alpha, destination], 1, next);
    assert.equal(next[index]?.label, "Wharf");
  });
});

describe("dwellStopAfterRevision", () => {
  it("stays on the place being dwelled when a waypoint is inserted ahead of it", () => {
    const destination = stop("Dock", 41);
    const waypoint = stop("Wharf", 40.5);
    assert.equal(dwellStopAfterRevision([destination], 0, [waypoint, destination]), 1);
  });
});

describe("samePlaceOrder", () => {
  it("ignores wait and passenger edits", () => {
    const place = stop("Dock", 41);
    assert.equal(samePlaceOrder([place], [{ ...place, waitMinutes: 5, passenger: true }]), true);
    assert.equal(samePlaceOrder([place], [stop("Wharf", 40)]), false);
  });
});
