import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sortie } from "@groundops/contracts";
import { departureAlertMarks, formatCountdown, nextDeparture } from "./nextDeparture";

describe("nextDeparture", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");

  it("picks the earliest future uncommenced departure", () => {
    const chosen = nextDeparture(
      [
        sortie({
          id: "past",
          scheduledStart: "2026-09-02T11:00:00.000Z",
          label: "Past",
        }),
        sortie({
          id: "later",
          scheduledStart: "2026-09-02T14:00:00.000Z",
          label: "Later",
          stops: [stop("destination", "Later stop")],
        }),
        sortie({
          id: "soon",
          scheduledStart: "2026-09-02T13:00:00.000Z",
          label: "Soon",
          stops: [stop("pickup", "Soon stop")],
        }),
        sortie({
          id: "commenced",
          scheduledStart: "2026-09-02T12:30:00.000Z",
          actualStart: "2026-09-02T12:25:00.000Z",
          label: "Going",
        }),
      ],
      now,
    );
    assert.equal(chosen?.sortieId, "soon");
    assert.equal(chosen?.label, "Soon stop");
  });

  it("returns null when nothing is ahead", () => {
    assert.equal(nextDeparture([], now), null);
    assert.equal(
      nextDeparture(
        [sortie({ id: "done", scheduledStart: "2026-09-02T11:00:00.000Z", actualStart: "2026-09-02T11:00:00.000Z" })],
        now,
      ),
      null,
    );
  });
});

describe("departureAlertMarks", () => {
  it("keeps only marks still in the future", () => {
    const departAt = new Date("2026-09-02T12:10:00.000Z");
    const marks = departureAlertMarks(departAt, new Date("2026-09-02T12:06:00.000Z"));
    assert.deepEqual(
      marks.map((mark) => mark.minutesBefore),
      [1, 0],
    );
  });
});

describe("formatCountdown", () => {
  it("formats hours when needed", () => {
    assert.equal(formatCountdown(3661000), "1:01:01");
    assert.equal(formatCountdown(61000), "1:01");
  });
});

function sortie(partial: {
  id: string;
  scheduledStart: string;
  actualStart?: string | null;
  label?: string;
  stops?: Sortie["stops"];
}): Sortie {
  return {
    id: partial.id,
    type: "task",
    label: partial.label ?? "",
    arrivalAt: partial.scheduledStart,
    arrivalAuthored: true,
    scheduledStart: partial.scheduledStart,
    scheduledEnd: partial.scheduledStart,
    actualStart: partial.actualStart ?? null,
    departureAddress: "",
    passengerName: null,
    passengerPhone: null,
    stops: partial.stops ?? [stop("destination", "Place")],
  };
}

function stop(role: "pickup" | "destination", label: string): Sortie["stops"][number] {
  return { role, label, latitude: 40, longitude: -74, waitMinutes: 0 };
}
