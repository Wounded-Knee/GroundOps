import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sortie, SortieWriteRequest } from "@groundops/contracts";
import { taskSortieType } from "@groundops/contracts";
import { distanceMeters } from "./guidance";
import { overlaySorties, provisionalMetersPerSecond, provisionalWindow, rangeCovers } from "./provisionalWindow";

const now = new Date("2026-09-02T15:00:00.000Z");

function sortie(partial: Partial<Sortie> & Pick<Sortie, "id" | "arrivalAt" | "scheduledStart" | "scheduledEnd">): Sortie {
  return {
    type: taskSortieType,
    label: "Task",
    arrivalAuthored: true,
    actualStart: null,
    actualEnd: null,
    departureAddress: "",
    passengerName: null,
    passengerPhone: null,
    stops: [stop("A", 40, -74)],
    ...partial,
  };
}

function stop(label: string, latitude: number, longitude: number) {
  return {
    label,
    latitude,
    longitude,
    waitMinutes: 0,
    passenger: true,
    actualArrivedAt: null,
    actualDepartedAt: null,
  };
}

function body(arrivalAt: string | null, stops: SortieWriteRequest["stops"]): SortieWriteRequest {
  return { label: "Task", arrivalAt, passengerName: null, passengerPhone: null, stops };
}

describe("provisional window", () => {
  it("shifts an existing window by the arrival delta when the stops stay", () => {
    const previous = sortie({
      id: "one",
      arrivalAt: "2026-09-02T16:00:00.000Z",
      scheduledStart: "2026-09-02T15:30:00.000Z",
      scheduledEnd: "2026-09-02T17:00:00.000Z",
    });
    const window = provisionalWindow({
      previous,
      body: body("2026-09-02T16:15:00.000Z", previous.stops),
      sorties: [previous],
      gps: null,
      now,
    });
    assert.equal(typeof window, "object");
    if (typeof window !== "object") {
      return;
    }
    assert.equal(window.origin, "shifted");
    assert.equal(window.arrivalAt, "2026-09-02T16:15:00.000Z");
    assert.equal(window.scheduledStart, "2026-09-02T15:45:00.000Z");
    assert.equal(window.scheduledEnd, "2026-09-02T17:15:00.000Z");
  });

  it("estimates a new stop list from the device fix when nothing is still open", () => {
    const destination = { label: "B", latitude: 40.1, longitude: -74, waitMinutes: 5, passenger: true };
    const gps = { latitude: 40, longitude: -74 };
    const window = provisionalWindow({
      previous: null,
      body: body(null, [destination]),
      sorties: [],
      gps,
      now,
    });
    assert.equal(typeof window, "object");
    if (typeof window !== "object") {
      return;
    }
    const approach = distanceMeters(gps, destination) / provisionalMetersPerSecond;
    assert.equal(window.origin, "gps");
    assert.equal(window.scheduledStart, now.toISOString());
    assert.equal(window.arrivalAt, new Date(now.getTime() + approach * 1000).toISOString());
    assert.equal(window.scheduledEnd, new Date(now.getTime() + (approach + 5 * 60) * 1000).toISOString());
  });

  it("does not invent a window without an origin", () => {
    const window = provisionalWindow({
      previous: null,
      body: body(null, [{ label: "B", latitude: 1, longitude: 2, waitMinutes: 0, passenger: false }]),
      sorties: [],
      gps: null,
      now,
    });
    assert.equal(window, "no-origin");
  });

  it("shows a cached range only when it covers the period, and pending sorties replace those ids", () => {
    const cached = { from: "2026-09-02T00:00:00.000Z", to: "2026-09-03T00:00:00.000Z" };
    assert.equal(
      rangeCovers(cached, { from: new Date("2026-09-02T04:00:00.000Z"), to: new Date("2026-09-02T05:00:00.000Z") }),
      true,
    );
    assert.equal(
      rangeCovers(cached, { from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-09-08T00:00:00.000Z") }),
      false,
    );
    const server = sortie({
      id: "server",
      arrivalAt: "2026-09-02T16:00:00.000Z",
      scheduledStart: "2026-09-02T15:00:00.000Z",
      scheduledEnd: "2026-09-02T17:00:00.000Z",
    });
    const pending = sortie({
      id: "server",
      label: "Moved",
      arrivalAt: "2026-09-02T18:00:00.000Z",
      scheduledStart: "2026-09-02T17:00:00.000Z",
      scheduledEnd: "2026-09-02T19:00:00.000Z",
    });
    const created = sortie({
      id: "created",
      arrivalAt: "2026-09-02T12:00:00.000Z",
      scheduledStart: "2026-09-02T11:00:00.000Z",
      scheduledEnd: "2026-09-02T12:30:00.000Z",
    });
    const overlaid = overlaySorties([server], [pending, created]);
    assert.deepEqual(
      overlaid.map((item) => item.id),
      ["created", "server"],
    );
    assert.equal(overlaid[1]?.label, "Moved");
  });
});
