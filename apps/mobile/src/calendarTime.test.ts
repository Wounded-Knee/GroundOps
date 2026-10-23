import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  availabilityBlocksOnDay,
  blockOnDay,
  calendarDayDelta,
  clampHourHeight,
  clipActivitiesToDay,
  zoomedScrollY,
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
  parseAvailabilityIntervals,
  historySorties,
  periodLabel,
  placeLanes,
  resizeEnd,
  resizeStart,
  setCalendarTimeZoneOverride,
  shiftAnchor,
  shiftIntervalDays,
  sortieActivitySegments,
  sortieIsPast,
  startOfDay,
  upcomingSorties,
  visibleRange,
} from "./calendarTime.js";
import { distanceMeters } from "./guidance.js";
import { coalescedEndDate } from "./sortieStart.js";
import { activitySegmentColor } from "./theme.js";

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

  it("places overlapping sorties side by side and keeps abutting ones full width", () => {
    const day = new Date(2026, 8, 28, 12);
    const overlapping = placeLanes(
      [
        { id: "b", start: new Date(2026, 8, 28, 10, 0), end: new Date(2026, 8, 28, 12, 0) },
        { id: "a", start: new Date(2026, 8, 28, 9, 0), end: new Date(2026, 8, 28, 11, 0) },
      ],
      day,
    );
    assert.deepEqual(overlapping.get("a"), { column: 0, span: 1, columns: 2 });
    assert.deepEqual(overlapping.get("b"), { column: 1, span: 1, columns: 2 });

    const sameStart = placeLanes(
      [
        { id: "b", start: new Date(2026, 8, 28, 9, 0), end: new Date(2026, 8, 28, 11, 0) },
        { id: "a", start: new Date(2026, 8, 28, 9, 0), end: new Date(2026, 8, 28, 11, 0) },
      ],
      day,
    );
    assert.equal(sameStart.get("a")?.column, 0);
    assert.equal(sameStart.get("b")?.column, 1);

    const abutting = placeLanes(
      [
        { id: "early", start: new Date(2026, 8, 28, 9, 0), end: new Date(2026, 8, 28, 10, 0) },
        { id: "later", start: new Date(2026, 8, 28, 10, 0), end: new Date(2026, 8, 28, 11, 0) },
      ],
      day,
    );
    assert.deepEqual(abutting.get("early"), { column: 0, span: 1, columns: 1 });
    assert.deepEqual(abutting.get("later"), { column: 0, span: 1, columns: 1 });
    assert.equal(placeLanes([{ id: "gone", start: new Date(2026, 8, 27, 9, 0), end: new Date(2026, 8, 27, 10, 0) }], day).size, 0);
  });

  it("expands a block into empty lanes on its right", () => {
    const day = new Date(2026, 8, 28, 12);
    const lanes = placeLanes(
      [
        { id: "a", start: new Date(2026, 8, 28, 8, 0), end: new Date(2026, 8, 28, 12, 0) },
        { id: "b", start: new Date(2026, 8, 28, 8, 0), end: new Date(2026, 8, 28, 9, 0) },
        { id: "c", start: new Date(2026, 8, 28, 8, 0), end: new Date(2026, 8, 28, 9, 0) },
        { id: "d", start: new Date(2026, 8, 28, 10, 0), end: new Date(2026, 8, 28, 11, 0) },
      ],
      day,
    );
    assert.deepEqual(lanes.get("a"), { column: 0, span: 1, columns: 3 });
    assert.deepEqual(lanes.get("b"), { column: 1, span: 1, columns: 3 });
    assert.deepEqual(lanes.get("c"), { column: 2, span: 1, columns: 3 });
    assert.deepEqual(lanes.get("d"), { column: 1, span: 2, columns: 3 });
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

  it("keeps the pinch anchor under a moving focal point", () => {
    const anchor = 952.52;
    const startHourPx = 64;
    const nextHourPx = 128;
    const viewport = 508;
    const pinned = zoomedScrollY(anchor, startHourPx, nextHourPx, 266.64, viewport);
    assert.equal(pinned + 266.64, anchor * (nextHourPx / startHourPx));
    const followed = zoomedScrollY(anchor, startHourPx, nextHourPx, 266.64 + 101, viewport);
    assert.equal(followed + 266.64 + 101, anchor * (nextHourPx / startHourPx));
    assert.ok(followed < pinned);
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

  it("parses availability intervals and clips them onto a day", () => {
    const open = { start: "2026-10-11T14:00:00.000Z", end: null };
    const closed = { start: "2026-10-11T16:00:00.000Z", end: "2026-10-11T17:00:00.000Z" };
    assert.deepEqual(parseAvailabilityIntervals([open, closed]), [open, closed]);
    assert.equal(parseAvailabilityIntervals([{ start: 1, end: null }]), null);
    assert.equal(parseAvailabilityIntervals(null), null);

    const day = new Date(2026, 8, 28, 12);
    const overnight = availabilityBlocksOnDay(
      [{ start: new Date(2026, 8, 27, 23, 0).toISOString(), end: new Date(2026, 8, 28, 1, 0).toISOString() }],
      day,
      new Date(2026, 8, 28, 15, 0),
    );
    assert.deepEqual(overnight, [{ top: 0, height: 64 }]);

    const now = new Date(2026, 8, 28, 10, 30);
    const openBlocks = availabilityBlocksOnDay(
      [{ start: new Date(2026, 8, 28, 9, 0).toISOString(), end: null }],
      day,
      now,
    );
    assert.deepEqual(openBlocks, [{ top: 9 * 64, height: 1.5 * 64 }]);
  });

  it("reads every authored sortie for the agenda", () => {
    const anchor = new Date(2026, 8, 28, 15, 30);
    const range = visibleRange("agenda", anchor);
    assert.equal(range.from.toISOString(), "1970-01-01T00:00:00.000Z");
    assert.equal(range.to.toISOString(), "2100-01-01T00:00:00.000Z");
    assert.equal(periodLabel("agenda", anchor), "Agenda");
    assert.equal(shiftAnchor("agenda", anchor, 1).getTime(), anchor.getTime());
  });

  it("splits upcoming and history around now", () => {
    const now = new Date("2026-10-11T15:00:00.000Z");
    const future = agendaSortie("b-future", "2026-10-11T18:00:00.000Z", "2026-10-11T19:00:00.000Z");
    const sooner = agendaSortie("a-sooner", "2026-10-11T16:00:00.000Z", "2026-10-11T17:00:00.000Z");
    const sameStart = agendaSortie("c-tie", "2026-10-11T16:00:00.000Z", "2026-10-11T16:30:00.000Z");
    const happening = agendaSortie("happening", "2026-10-11T14:00:00.000Z", "2026-10-11T16:00:00.000Z", {
      actualStart: "2026-10-11T14:05:00.000Z",
    });
    const overdue = agendaSortie("overdue", "2026-10-11T12:00:00.000Z", "2026-10-11T13:00:00.000Z", {
      actualStart: "2026-10-11T12:05:00.000Z",
    });
    const completed = agendaSortie("completed", "2026-10-11T08:00:00.000Z", "2026-10-11T09:00:00.000Z", {
      actualStart: "2026-10-11T08:00:00.000Z",
      actualEnd: "2026-10-11T09:30:00.000Z",
    });
    const missed = agendaSortie("missed", "2026-10-11T10:00:00.000Z", "2026-10-11T11:00:00.000Z");
    const endedEarlier = agendaSortie("earlier", "2026-10-10T10:00:00.000Z", "2026-10-10T11:00:00.000Z", {
      actualEnd: "2026-10-10T11:00:00.000Z",
    });

    assert.equal(sortieIsPast(happening, now), false);
    assert.equal(sortieIsPast(overdue, now), true);
    assert.equal(sortieIsPast(completed, now), true);
    assert.equal(sortieIsPast(missed, now), true);
    const upcoming = upcomingSorties([future, happening, overdue, sooner, sameStart, completed, missed], now);
    assert.deepEqual(
      upcoming.map((sortie) => sortie.id),
      ["happening", "a-sooner", "c-tie", "b-future"],
    );
    for (const sortie of upcoming) {
      assert.ok(coalescedEndDate(sortie).getTime() > now.getTime(), `${sortie.id} has already ended`);
    }
    assert.deepEqual(
      historySorties([completed, missed, endedEarlier, overdue, future], now).map((sortie) => sortie.id),
      ["overdue", "missed", "completed", "earlier"],
    );
  });
});

describe("sortie activity segments", () => {
  it("draws one passenger band and keeps the arrival inside it", () => {
    const start = new Date(2026, 8, 28, 9, 0);
    const arrival = new Date(2026, 8, 28, 9, 40);
    const end = new Date(2026, 8, 28, 10, 0);
    const activities = sortieActivitySegments(
      activitySortie(start, arrival, end, [stop("Pickup", true, 0, 40, -75)]),
    );
    assert.equal(activities.segments.length, 1);
    assert.equal(activities.segments[0]?.kind, "passenger");
    assert.equal(activities.segments[0]?.start.getTime(), start.getTime());
    assert.equal(activities.segments[0]?.end.getTime(), end.getTime());
    assert.equal(activities.arrivals.length, 1);
    assert.equal(activities.arrivals[0]?.label, "Pickup");
    assert.equal(activities.arrivals[0]?.at.getTime(), arrival.getTime());

    const clipped = clipActivitiesToDay(activities, start, end, start);
    assert.equal(clipped.bands.length, 1);
    assert.equal(clipped.bands[0]?.fraction, 1);
    assert.equal(clipped.arrivals[0]?.fraction, 40 / 60);
  });

  it("places a dead-head approach before the authored wait", () => {
    const start = new Date(2026, 8, 28, 9, 0);
    const arrival = new Date(2026, 8, 28, 10, 0);
    const end = new Date(2026, 8, 28, 10, 30);
    const activities = sortieActivitySegments(
      activitySortie(start, arrival, end, [stop("Yard", false, 30, 40, -75)]),
    );
    assert.deepEqual(
      activities.segments.map((segment) => segment.kind),
      ["deadhead", "wait"],
    );
    assert.equal(activities.segments[0]?.end.getTime(), arrival.getTime());
    assert.equal(activities.segments[1]?.start.getTime(), arrival.getTime());
    assert.equal(activities.segments[1]?.end.getTime(), end.getTime());
    assert.equal(activities.arrivals[0]?.at.getTime(), arrival.getTime());
  });

  it("splits the onward drive across later stops by distance", () => {
    const start = new Date(2026, 8, 28, 9, 0);
    const arrival = new Date(2026, 8, 28, 9, 30);
    const end = new Date(2026, 8, 28, 11, 0);
    const stops = [stop("Yard", false, 10, 40, -75), stop("Home", true, 20, 40, -74)];
    const activities = sortieActivitySegments(activitySortie(start, arrival, end, stops));
    assert.deepEqual(
      activities.segments.map((segment) => segment.kind),
      ["deadhead", "wait", "passenger", "wait"],
    );
    assert.equal(durationMs(activities.segments[0]), 30 * 60_000);
    assert.equal(durationMs(activities.segments[1]), 10 * 60_000);
    assert.equal(durationMs(activities.segments[2]), 60 * 60_000);
    assert.equal(durationMs(activities.segments[3]), 20 * 60_000);
    assert.equal(activities.arrivals[0]?.at.getTime(), arrival.getTime());
    assert.equal(activities.arrivals[1]?.at.getTime(), new Date(2026, 8, 28, 10, 40).getTime());

    const far = [
      stop("A", false, 0, 40, -75),
      stop("B", true, 0, 40, -74.9),
      stop("C", true, 0, 40, -74.7),
    ];
    const splitStart = new Date(2026, 8, 28, 9, 0);
    const splitArrival = new Date(2026, 8, 28, 10, 0);
    const splitEnd = new Date(2026, 8, 28, 11, 0);
    const split = sortieActivitySegments(activitySortie(splitStart, splitArrival, splitEnd, far));
    const firstLeg = distanceMeters(
      { latitude: 40, longitude: -75 },
      { latitude: 40, longitude: -74.9 },
    );
    const secondLeg = distanceMeters(
      { latitude: 40, longitude: -74.9 },
      { latitude: 40, longitude: -74.7 },
    );
    const residual = 60 * 60_000;
    assertClose(durationMs(split.segments[1]), (residual * firstLeg) / (firstLeg + secondLeg));
    assertClose(durationMs(split.segments[2]), residual - durationMs(split.segments[1]));
    assert.equal(split.segments[1]?.kind, "passenger");
    assert.equal(split.segments[2]?.kind, "passenger");
    assert.equal(split.arrivals.length, 3);
  });

  it("shrinks drives and scales waits when dwell already fills the window", () => {
    const start = new Date(2026, 8, 28, 9, 0);
    const arrival = new Date(2026, 8, 28, 9, 20);
    const end = new Date(2026, 8, 28, 10, 0);
    const activities = sortieActivitySegments(
      activitySortie(start, arrival, end, [
        stop("First", false, 30, 40, -75),
        stop("Second", true, 30, 41, -75),
      ]),
    );
    assert.deepEqual(
      activities.segments.map((segment) => segment.kind),
      ["deadhead", "wait", "wait"],
    );
    assert.equal(durationMs(activities.segments[0]), 20 * 60_000);
    assert.equal(durationMs(activities.segments[1]), 20 * 60_000);
    assert.equal(durationMs(activities.segments[2]), 20 * 60_000);
    assert.equal(activities.arrivals[1]?.at.getTime(), new Date(2026, 8, 28, 9, 40).getTime());
  });

  it("drops a next-day arrival from the first day's slice", () => {
    const start = new Date(2026, 8, 28, 22, 0);
    const arrival = new Date(2026, 8, 28, 23, 0);
    const end = new Date(2026, 8, 29, 2, 0);
    const activities = sortieActivitySegments(
      activitySortie(start, arrival, end, [
        stop("Depot", false, 0, 40, -75),
        stop("Terminal", true, 60, 41, -75),
      ]),
    );
    assert.equal(activities.arrivals[0]?.at.getTime(), arrival.getTime());
    assert.equal(activities.arrivals[1]?.at.getTime(), new Date(2026, 8, 29, 1, 0).getTime());

    const firstDay = clipActivitiesToDay(activities, start, end, start);
    assert.deepEqual(
      firstDay.bands.map((band) => band.kind),
      ["deadhead", "passenger"],
    );
    assertClose(firstDay.bands[0]?.fraction ?? 0, 0.5);
    assertClose(firstDay.bands[1]?.fraction ?? 0, 0.5);
    assert.deepEqual(
      firstDay.arrivals.map((mark) => mark.label),
      ["Depot"],
    );
    assertClose(firstDay.arrivals[0]?.fraction ?? 0, 0.5);

    const secondDay = clipActivitiesToDay(activities, start, end, end);
    assert.deepEqual(
      secondDay.bands.map((band) => band.kind),
      ["passenger", "wait"],
    );
    assert.deepEqual(
      secondDay.arrivals.map((mark) => mark.label),
      ["Terminal"],
    );
    assertClose(secondDay.arrivals[0]?.fraction ?? 0, 0.5);
    assertClose(
      secondDay.bands.reduce((sum, band) => sum + band.fraction, 0),
      1,
    );
  });

  it("shares one line when two stops arrive together", () => {
    const start = new Date(2026, 8, 28, 9, 0);
    const arrival = new Date(2026, 8, 28, 10, 0);
    const activities = sortieActivitySegments(
      activitySortie(start, arrival, arrival, [
        stop("Gate", false, 0, 40, -75),
        stop("Stand", false, 0, 40, -75),
      ]),
    );
    assert.equal(activities.arrivals.length, 1);
    assert.equal(activities.arrivals[0]?.label, "Gate · Stand");
    assert.equal(activities.arrivals[0]?.at.getTime(), arrival.getTime());
  });
});

describe("activity segment colors", () => {
  it("keeps passenger on the base color and shades dead-head and wait", () => {
    assert.equal(activitySegmentColor("#111111", "passenger"), "#111111");
    assert.equal(activitySegmentColor("#111111", "deadhead"), "#646464");
    assert.equal(activitySegmentColor("#111111", "wait"), "#8e7308");
    assert.equal(activitySegmentColor("#f2f2f2", "deadhead"), "#9d9d9d");
  });
});

function activitySortie(
  start: Date,
  arrival: Date,
  end: Date,
  stops: ReturnType<typeof stop>[],
) {
  return {
    actualStart: null,
    scheduledStart: start.toISOString(),
    actualEnd: null,
    scheduledEnd: end.toISOString(),
    arrivalAt: arrival.toISOString(),
    stops,
  };
}

function stop(label: string, passenger: boolean, waitMinutes: number, latitude: number, longitude: number) {
  return {
    label,
    latitude,
    longitude,
    waitMinutes,
    passenger,
    actualArrivedAt: null,
    actualDepartedAt: null,
  };
}

function durationMs(segment: { start: Date; end: Date } | undefined): number {
  return (segment?.end.getTime() ?? 0) - (segment?.start.getTime() ?? 0);
}

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= 1, `${actual} not close to ${expected}`);
}

function agendaSortie(
  id: string,
  scheduledStart: string,
  scheduledEnd: string,
  actuals: { actualStart?: string | null; actualEnd?: string | null } = {},
) {
  return {
    id,
    scheduledStart,
    scheduledEnd,
    actualStart: actuals.actualStart ?? null,
    actualEnd: actuals.actualEnd ?? null,
  };
}