import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RealtimeEnvelope, Sortie } from "@groundops/contracts";
import {
  applyEnvelope,
  applySnapshot,
  emptyActivity,
  overviewFitPoints,
  overviewFrameKey,
  overviewPathForUpload,
  reportDelayMs,
} from "./liveActivity";

const path = [
  { latitude: 40, longitude: -74 },
  { latitude: 41, longitude: -73 },
];
const stops = [
  { latitude: 40.1, longitude: -74.1 },
  { latitude: 40.8, longitude: -73.2 },
];

describe("account activity", () => {
  it("keeps a snapshot ahead of an older buffered envelope", () => {
    const snapshot = applySnapshot({
      asOf: "2026-10-09T12:00:02.000Z",
      location: { latitude: 2, longitude: 3, accuracyMeters: 5, observedAt: "2026-10-09T12:00:02.000Z" },
      sortie: null,
      meter: null,
    });
    const older: RealtimeEnvelope = {
      id: "00000000-0000-4000-8000-000000000001",
      type: "location.updated",
      userId: "user",
      recordedAt: "2026-10-09T12:00:01.000Z",
      location: { latitude: 1, longitude: 1, accuracyMeters: null, observedAt: "2026-10-09T12:00:01.000Z" },
    };
    const applied = applyEnvelope(snapshot, older);
    assert.equal(applied.calendarChanged, false);
    assert.equal(applied.state.location?.latitude, 2);
  });

  it("refreshes the calendar for a newer sortie update", () => {
    const sortie = sampleSortie();
    const applied = applyEnvelope(emptyActivity, {
      id: "00000000-0000-4000-8000-000000000002",
      type: "sortie.updated",
      userId: "user",
      recordedAt: "2026-10-09T12:00:03.000Z",
      sortie,
    });
    assert.equal(applied.calendarChanged, true);
    assert.equal(applied.state.sortie?.id, sortie.id);
  });

  it("fits the full path, every stop, and the vehicle, then leaves the frame when the vehicle moves", () => {
    const vehicle = { latitude: 40.2, longitude: -74.2 };
    const points = overviewFitPoints(path, stops, vehicle);
    assert.equal(points.length, path.length + stops.length + 1);
    assert.deepEqual(points[points.length - 1], vehicle);
    const framed = overviewFrameKey(path, stops, true);
    const moved = overviewFrameKey(path, stops, true);
    assert.equal(framed, moved);
  });

  it("does not replace the overview path for a remaining-leg reroute", () => {
    assert.deepEqual(overviewPathForUpload("guidance-start", 0, path), path);
    assert.equal(overviewPathForUpload("guidance-start", 1, path), undefined);
    assert.equal(overviewPathForUpload("remaining-leg", 1, path), undefined);
    assert.equal(overviewPathForUpload("tick", 0, path), undefined);
    assert.deepEqual(overviewPathForUpload("stops-revised", 2, path), path);
  });

  it("sends the first meter report immediately and throttles the next", () => {
    assert.equal(reportDelayMs(null, 1_000, false), 0);
    assert.equal(reportDelayMs(1_000, 1_200, false), 800);
    assert.equal(reportDelayMs(1_000, 1_200, true), 0);
  });
});

function sampleSortie(): Sortie {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    type: "task",
    label: "Airport",
    arrivalAt: "2026-10-09T12:30:00.000Z",
    arrivalAuthored: true,
    scheduledStart: "2026-10-09T12:00:00.000Z",
    scheduledEnd: "2026-10-09T13:00:00.000Z",
    actualStart: "2026-10-09T12:00:00.000Z",
    actualEnd: null,
    departureAddress: "Home",
    passengerName: null,
    passengerPhone: null,
    stops: [
      {
        label: "Terminal",
        latitude: 40.64,
        longitude: -73.78,
        waitMinutes: 0,
        passenger: true,
        actualArrivedAt: null,
        actualDepartedAt: null,
      },
    ],
  };
}
