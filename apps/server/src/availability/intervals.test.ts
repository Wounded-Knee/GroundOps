import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foldCurrentAvailability } from "./intervals.js";

const from = new Date("2026-10-11T12:00:00.000Z");

describe("current availability intervals", () => {
  it("closes on a lapse while the choice stays available, then opens again on restore", () => {
    const on = new Date("2026-10-11T14:00:00.000Z");
    const lapse = new Date("2026-10-11T15:00:00.000Z");
    const restored = new Date("2026-10-11T16:00:00.000Z");
    const off = new Date("2026-10-11T17:00:00.000Z");
    const intervals = foldCurrentAvailability(
      false,
      [
        { recordedAt: on, current: true },
        { recordedAt: lapse, current: false },
        { recordedAt: restored, current: true },
        { recordedAt: off, current: false },
      ],
      from,
    );
    assert.deepEqual(intervals, [
      { start: on, end: lapse },
      { start: restored, end: off },
    ]);
  });

  it("leaves the end open while the server still treats the driver as available", () => {
    const on = new Date("2026-10-11T14:00:00.000Z");
    assert.deepEqual(foldCurrentAvailability(false, [{ recordedAt: on, current: true }], from), [
      { start: on, end: null },
    ]);
  });

  it("clips an interval that began before the range and ignores a repeated current flag", () => {
    const lapse = new Date("2026-10-11T15:00:00.000Z");
    assert.deepEqual(foldCurrentAvailability(true, [{ recordedAt: lapse, current: false }], from), [
      { start: from, end: lapse },
    ]);
    const on = new Date("2026-10-11T14:00:00.000Z");
    const again = new Date("2026-10-11T14:30:00.000Z");
    assert.deepEqual(
      foldCurrentAvailability(
        false,
        [
          { recordedAt: on, current: true },
          { recordedAt: again, current: true },
        ],
        from,
      ),
      [{ start: on, end: null }],
    );
  });
});
