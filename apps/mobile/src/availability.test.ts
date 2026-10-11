import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEnvelope, emptyActivity } from "./liveActivity";
import { applyAvailabilityEnvelope, emptyAvailability } from "./availability";

describe("availability bar", () => {
  it("brightens from a newer envelope and ignores one at or before asOf", () => {
    const newer = applyAvailabilityEnvelope(emptyAvailability, {
      id: "00000000-0000-4000-8000-000000000010",
      type: "availability.updated",
      userId: "user",
      recordedAt: "2026-10-11T16:00:00.000Z",
      available: true,
      current: true,
    });
    assert.equal(newer.current, true);
    assert.equal(newer.available, true);

    const older = applyAvailabilityEnvelope(newer, {
      id: "00000000-0000-4000-8000-000000000011",
      type: "availability.updated",
      userId: "user",
      recordedAt: "2026-10-11T16:00:00.000Z",
      available: false,
      current: false,
    });
    assert.equal(older, newer);

    const lapse = applyAvailabilityEnvelope(newer, {
      id: "00000000-0000-4000-8000-000000000012",
      type: "availability.updated",
      userId: "user",
      recordedAt: "2026-10-11T16:06:00.000Z",
      available: true,
      current: false,
    });
    assert.equal(lapse.current, false);
    assert.equal(lapse.available, true);
  });

  it("does not advance account activity", () => {
    const applied = applyEnvelope(emptyActivity, {
      id: "00000000-0000-4000-8000-000000000013",
      type: "availability.updated",
      userId: "user",
      recordedAt: "2026-10-11T16:06:00.000Z",
      available: true,
      current: false,
    });
    assert.equal(applied.calendarChanged, false);
    assert.equal(applied.state.asOf, "");
    assert.equal(applied.state, emptyActivity);
  });
});
