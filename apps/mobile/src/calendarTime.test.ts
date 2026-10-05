import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockOnDay,
  calendarDayDelta,
  clampHourHeight,
  formatUsPhone,
  hourHeightMax,
  hourHeightMin,
  minuteDeltaFromPixels,
  arrivalFromTimeInput,
  calendarTimeInputValue,
  minutesFromMidnight,
  moveInterval,
  nowLineTop,
  phoneDigits,
  resizeEnd,
  resizeStart,
  setCalendarTimeZoneOverride,
  shiftIntervalDays,
  startOfDay,
  visibleRange,
} from "./calendarTime.js";

describe("calendar time", () => {
  it("requests the visible month grid, week, and day", () => {
    const anchor = new Date(2026, 8, 28, 15, 30);
    const month = visibleRange("month", anchor);
    assert.equal(month.from.getDay(), 0);
    assert.equal(month.to.getDay(), 0);
    assert.ok(month.from <= new Date(2026, 8, 1));
    assert.ok(month.to > new Date(2026, 8, 30));

    const week = visibleRange("week", anchor);
    assert.equal(week.from.getDay(), 0);
    assert.equal(week.to.getTime() - week.from.getTime(), 7 * 24 * 60 * 60 * 1000);

    const day = visibleRange("day", anchor);
    assert.equal(day.from.getDate(), 28);
    assert.equal(day.to.getDate(), 29);
  });

  it("snaps a move to 15 minutes and keeps the duration", () => {
    const start = new Date(2026, 8, 28, 9, 0);
    const end = new Date(2026, 8, 28, 10, 30);
    const moved = moveInterval(start, end, 1, minuteDeltaFromPixels(70));
    assert.ok(moved);
    assert.equal(moved.start.getDate(), 29);
    assert.equal(moved.start.getHours(), 10);
    assert.equal(moved.start.getMinutes(), 0);
    assert.equal(moved.end.getTime() - moved.start.getTime(), end.getTime() - start.getTime());
    assert.equal(moveInterval(start, end, 0, 0), null);
  });

  it("resizes an edge and rejects an end that is not after the start", () => {
    const start = new Date(2026, 8, 28, 9, 0);
    const end = new Date(2026, 8, 28, 10, 0);
    const longer = resizeEnd(start, end, 30);
    assert.equal(longer?.end.getMinutes(), 30);
    assert.equal(resizeStart(start, end, 120), null);
    assert.equal(resizeEnd(start, end, -120), null);
  });

  it("shifts a month chip by whole days and keeps the clock time", () => {
    const start = new Date(2026, 8, 2, 15, 10);
    const end = new Date(2026, 8, 2, 16, 10);
    const shifted = shiftIntervalDays(start, end, calendarDayDelta(start, new Date(2026, 8, 5)));
    assert.equal(shifted?.start.getDate(), 5);
    assert.equal(shifted?.start.getHours(), 15);
    assert.equal(shifted?.start.getMinutes(), 10);
    assert.equal(shifted?.end.getHours(), 16);
  });

  it("places a block on the hours it covers", () => {
    const block = blockOnDay(new Date(2026, 8, 28, 9, 0), new Date(2026, 8, 28, 10, 0), new Date(2026, 8, 28, 12));
    assert.equal(block?.top, 9 * 64);
    assert.equal(block?.height, 64);
    assert.equal(blockOnDay(new Date(2026, 8, 27, 9, 0), new Date(2026, 8, 27, 10, 0), new Date(2026, 8, 28)), null);
    const zoomed = blockOnDay(new Date(2026, 8, 28, 9, 0), new Date(2026, 8, 28, 10, 0), new Date(2026, 8, 28, 12), 128);
    assert.equal(zoomed?.top, 9 * 128);
    assert.equal(zoomed?.height, 128);
    const short = blockOnDay(new Date(2026, 8, 28, 9, 0), new Date(2026, 8, 28, 9, 15), new Date(2026, 8, 28, 12));
    assert.equal(short?.height, 16);
  });

  it("clamps the hour scale used for pinch zoom", () => {
    assert.equal(clampHourHeight(hourHeightMin - 10), hourHeightMin);
    assert.equal(clampHourHeight(hourHeightMax + 10), hourHeightMax);
    assert.equal(clampHourHeight(80), 80);
    assert.equal(clampHourHeight(80.4), 80);
    assert.equal(clampHourHeight(80.6), 81);
    assert.equal(clampHourHeight(66.2, 3.5), 66 + 1 / 3.5);
    assert.equal(clampHourHeight(66.3, 3.5), 66 + 1 / 3.5);
  });

  it("formats a US phone and keeps ten digits", () => {
    assert.equal(formatUsPhone("5551234567"), "(555) 123-4567");
    assert.equal(formatUsPhone("(555) 123-4567"), "(555) 123-4567");
    assert.equal(phoneDigits("(555) 123-4567"), "5551234567");
    assert.equal(phoneDigits("555"), "555");
  });

  it("places the now-line using an explicit IANA zone when the runtime is UTC", () => {
    setCalendarTimeZoneOverride("America/New_York");
    try {
      // 2026-10-05T01:27:00Z == 2026-10-04 21:27 EDT
      const now = new Date("2026-10-05T01:27:00.000Z");
      assert.equal(minutesFromMidnight(now), 21 * 60 + 27);
      assert.equal(nowLineTop(now, 64), ((21 * 60 + 27) / 60) * 64);
      const day = startOfDay(now);
      assert.equal(day.toISOString(), "2026-10-04T04:00:00.000Z");
    } finally {
      setCalendarTimeZoneOverride(null);
    }
  });

  it("formats and parses web time inputs in the calendar zone", () => {
    setCalendarTimeZoneOverride("America/New_York");
    try {
      // 2026-10-04 17:50 EDT
      const arrival = new Date("2026-10-04T21:50:00.000Z");
      assert.equal(calendarTimeInputValue(arrival), "17:50");
      const next = arrivalFromTimeInput("17:50", arrival);
      assert.ok(next);
      assert.equal(next.toISOString(), "2026-10-04T21:50:00.000Z");
      const changed = arrivalFromTimeInput("18:15", arrival);
      assert.ok(changed);
      assert.equal(changed.toISOString(), "2026-10-04T22:15:00.000Z");
    } finally {
      setCalendarTimeZoneOverride(null);
    }
  });
});