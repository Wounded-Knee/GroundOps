import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayWaitMinutes } from "./sortieWait";

describe("displayWaitMinutes", () => {
  it("uses rounded dwell when arrive and depart are sealed", () => {
    assert.equal(
      displayWaitMinutes({
        label: "Pickup",
        latitude: 40,
        longitude: -74,
        waitMinutes: 10,
        passenger: true,
        actualArrivedAt: "2026-09-02T15:00:00.000Z",
        actualDepartedAt: "2026-09-02T15:07:30.000Z",
      }),
      8,
    );
  });

  it("falls back to authored wait when actuals are incomplete", () => {
    assert.equal(
      displayWaitMinutes({
        label: "Pickup",
        latitude: 40,
        longitude: -74,
        waitMinutes: 10,
        passenger: true,
        actualArrivedAt: "2026-09-02T15:00:00.000Z",
        actualDepartedAt: null,
      }),
      10,
    );
  });
});
