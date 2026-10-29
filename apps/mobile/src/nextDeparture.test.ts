import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sortie } from "@groundops/contracts";
import {
  departureAlertMarks,
  departurePrompt,
  dueDeparture,
  formatCountdown,
  nextDeparture,
  showDepartureCountdown,
} from "./nextDeparture";

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
          stops: [stop("Later stop")],
        }),
        sortie({
          id: "soon",
          scheduledStart: "2026-09-02T13:00:00.000Z",
          label: "Soon",
          stops: [stop("Soon stop")],
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

describe("dueDeparture", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");

  it("picks the earliest open uncommenced departure", () => {
    const chosen = dueDeparture(
      [
        sortie({
          id: "ended",
          scheduledStart: "2026-09-02T10:00:00.000Z",
          scheduledEnd: "2026-09-02T11:00:00.000Z",
          label: "Ended",
        }),
        sortie({
          id: "later-due",
          scheduledStart: "2026-09-02T11:30:00.000Z",
          scheduledEnd: "2026-09-02T13:00:00.000Z",
          label: "Later due",
          stops: [stop("Later due stop")],
        }),
        sortie({
          id: "due",
          scheduledStart: "2026-09-02T11:00:00.000Z",
          scheduledEnd: "2026-09-02T12:30:00.000Z",
          label: "Due",
          stops: [stop("Due stop")],
        }),
        sortie({
          id: "future",
          scheduledStart: "2026-09-02T12:10:00.000Z",
          scheduledEnd: "2026-09-02T13:00:00.000Z",
          label: "Future",
        }),
        sortie({
          id: "commenced",
          scheduledStart: "2026-09-02T11:15:00.000Z",
          scheduledEnd: "2026-09-02T13:00:00.000Z",
          actualStart: "2026-09-02T11:20:00.000Z",
          label: "Going",
        }),
      ],
      now,
    );
    assert.equal(chosen?.sortieId, "due");
    assert.equal(chosen?.label, "Due stop");
  });

  it("ignores future, commenced, and ended sorties", () => {
    const sorties = [
      sortie({
        id: "future",
        scheduledStart: "2026-09-02T13:00:00.000Z",
        scheduledEnd: "2026-09-02T14:00:00.000Z",
      }),
      sortie({
        id: "commenced",
        scheduledStart: "2026-09-02T11:00:00.000Z",
        scheduledEnd: "2026-09-02T13:00:00.000Z",
        actualStart: "2026-09-02T11:05:00.000Z",
      }),
      sortie({
        id: "ended",
        scheduledStart: "2026-09-02T10:00:00.000Z",
        scheduledEnd: "2026-09-02T11:30:00.000Z",
      }),
    ];
    assert.equal(dueDeparture(sorties, now), null);
    assert.equal(nextDeparture(sorties, now)?.sortieId, "future");
  });
});

describe("departurePrompt", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");

  it("lets a due sortie hide the countdown", () => {
    const sorties = [
      sortie({
        id: "due",
        scheduledStart: "2026-09-02T11:30:00.000Z",
        scheduledEnd: "2026-09-02T12:30:00.000Z",
        label: "Due",
      }),
      sortie({
        id: "soon",
        scheduledStart: "2026-09-02T12:10:00.000Z",
        scheduledEnd: "2026-09-02T13:00:00.000Z",
        label: "Soon",
      }),
    ];
    const due = dueDeparture(sorties, now);
    const upcoming = nextDeparture(sorties, now);
    assert.equal(due?.sortieId, "due");
    assert.equal(upcoming?.sortieId, "soon");
    assert.equal(departurePrompt(due, upcoming, now.getTime(), 30), "due");
    assert.equal(departurePrompt(due, upcoming, now.getTime(), null), "due");
  });

  it("shows the countdown only inside the lead when nothing is due", () => {
    const upcoming = nextDeparture(
      [
        sortie({
          id: "soon",
          scheduledStart: "2026-09-02T12:10:00.000Z",
          scheduledEnd: "2026-09-02T13:00:00.000Z",
        }),
      ],
      now,
    );
    assert.equal(departurePrompt(null, upcoming, now.getTime(), 30), "countdown");
    assert.equal(departurePrompt(null, upcoming, now.getTime(), 5), "hidden");
    assert.equal(departurePrompt(null, upcoming, now.getTime(), null), "hidden");
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

describe("showDepartureCountdown", () => {
  it("shows only inside the configured lead", () => {
    assert.equal(showDepartureCountdown(15 * 60 * 1000, 15), true);
    assert.equal(showDepartureCountdown(15 * 60 * 1000 + 1, 15), false);
    assert.equal(showDepartureCountdown(120 * 60 * 1000, 120), true);
    assert.equal(showDepartureCountdown(0, 30), true);
    assert.equal(showDepartureCountdown(-1, 30), false);
    assert.equal(showDepartureCountdown(0, null), false);
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
  scheduledEnd?: string;
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
    scheduledEnd: partial.scheduledEnd ?? partial.scheduledStart,
    actualStart: partial.actualStart ?? null,
    actualEnd: null,
    departureAddress: "",
    passengerName: null,
    passengerPhone: null,
    stops: partial.stops ?? [stop("Place", true)],
  };
}

function stop(label: string, passenger = false): Sortie["stops"][number] {
  return {
    label,
    latitude: 40,
    longitude: -74,
    waitMinutes: 0,
    passenger,
    actualArrivedAt: null,
    actualDepartedAt: null,
  };
}
