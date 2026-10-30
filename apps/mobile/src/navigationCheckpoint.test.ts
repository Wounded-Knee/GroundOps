import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sortie } from "@groundops/contracts";
import { defaultTariff } from "@groundops/contracts";
import { emptyMeter } from "./meter";
import { emptyArrivalDwell } from "./sortieDwell";
import {
  assembleCheckpoint,
  meterForCheckpoint,
  parseNavigationCheckpoint,
  shouldAbandonRestoredSortie,
  shouldSettleRestoredDwell,
  type NavigationCheckpoint,
  type SortieGuidingSession,
} from "./navigationCheckpoint";

const userId = "user-1";
const origin = { latitude: 40.7, longitude: -74 };

function sortie(overrides: Partial<Sortie> = {}): Sortie {
  return {
    id: "sortie-1",
    type: "task",
    label: "Airport",
    arrivalAt: "2026-10-11T15:00:00.000Z",
    arrivalAuthored: true,
    scheduledStart: "2026-10-11T14:30:00.000Z",
    scheduledEnd: "2026-10-11T15:10:00.000Z",
    actualStart: "2026-10-11T14:40:00.000Z",
    actualEnd: null,
    departureAddress: "Home",
    passengerName: "Ada",
    passengerPhone: null,
    stops: [
      {
        label: "Airport",
        latitude: 40.64,
        longitude: -73.78,
        waitMinutes: 2,
        passenger: true,
        actualArrivedAt: null,
        actualDepartedAt: null,
      },
    ],
    ...overrides,
  };
}

function guiding(current: Sortie = sortie()): SortieGuidingSession {
  const step = {
    instruction: "Turn left",
    maneuver: "turn-left" as const,
    distanceMeters: 400,
    durationSeconds: 60,
    path: [origin, { latitude: 40.71, longitude: -74 }],
  };
  return {
    mode: "guiding",
    kind: "sortie",
    destination: { ...origin, label: "Airport", name: "Airport", detail: "Queens" },
    route: {
      distanceMeters: 400,
      durationSeconds: 60,
      path: step.path,
      steps: [step],
      legs: [{ distanceMeters: 400, durationSeconds: 60, path: step.path, steps: [step] }],
    },
    stepIndex: 0,
    muted: false,
    offRouteSince: null,
    rerouteMessage: null,
    sortieId: current.id,
    stops: current.stops,
    firstStopPosition: 0,
    tariff: defaultTariff,
    sortie: current,
  };
}

function checkpoint(): NavigationCheckpoint {
  return assembleCheckpoint({
    userId,
    savedAt: 1_700_000_000_000,
    nav: guiding(),
    meter: { ...emptyMeter(), milesTraveled: 1.5, waitSeconds: 40, flagDropped: true, alongMeters: 120 },
    baselineRemainingMeters: 800,
    cameraMode: "overview",
    dwell: { anchor: origin, startedAtMs: 1_700_000_000_000, satisfied: false },
    spokenKey: "2:0",
    completedLegPaths: [[origin, { latitude: 40.71, longitude: -74 }]],
    routeEpoch: 2,
  });
}

describe("navigation checkpoint", () => {
  it("round-trips a guiding session and drops the meter sample", () => {
    const meter = {
      ...emptyMeter(),
      milesTraveled: 1.5,
      waitSeconds: 40,
      flagDropped: true,
      alongMeters: 120,
      motion: "stationary" as const,
      last: { fix: origin, observedAtMs: 1_000, accuracyMeters: 8 },
    };
    const stored = assembleCheckpoint({
      userId,
      savedAt: 50,
      nav: guiding(),
      meter,
      baselineRemainingMeters: 800,
      cameraMode: "follow",
      dwell: emptyArrivalDwell(),
      spokenKey: null,
      completedLegPaths: [],
      routeEpoch: 0,
    });
    assert.equal(stored.meter.last, null);
    assert.equal(stored.meter.motion, "unknown");
    assert.equal(stored.meter.milesTraveled, 1.5);
    assert.equal(meterForCheckpoint(stored.meter), stored.meter);

    const parsed = parseNavigationCheckpoint(JSON.parse(JSON.stringify(stored)), userId);
    assert.deepEqual(parsed, stored);
  });

  it("rejects a different user, an unknown version, search guidance, and corrupt fields", () => {
    const stored = checkpoint();
    assert.equal(parseNavigationCheckpoint(stored, "someone-else"), null);
    assert.equal(parseNavigationCheckpoint({ ...stored, version: 2 }, userId), null);
    assert.equal(parseNavigationCheckpoint({ ...stored, nav: { ...stored.nav, kind: "search" } }, userId), null);
    assert.equal(parseNavigationCheckpoint({ ...stored, routeEpoch: -1 }, userId), null);
    assert.equal(parseNavigationCheckpoint("not-json", userId), null);
    assert.equal(
      parseNavigationCheckpoint({ ...stored, meter: { ...stored.meter, milesTraveled: -1 } }, userId),
      null,
    );
  });

  it("strips a stored GPS sample so a later tick cannot bill the dead interval", () => {
    const stored = checkpoint();
    const withSample = {
      ...stored,
      meter: {
        ...stored.meter,
        last: { fix: origin, observedAtMs: 1, accuracyMeters: 5 },
        motion: "stationary",
      },
    };
    const parsed = parseNavigationCheckpoint(withSample, userId);
    assert.ok(parsed);
    assert.equal(parsed.meter.last, null);
    assert.equal(parsed.meter.motion, "unknown");
    assert.equal(parsed.meter.waitSeconds, stored.meter.waitSeconds);
  });

  it("keeps an open matching sortie and drops a finished, missing, or different one", () => {
    const nav = guiding();
    const open = sortie();
    assert.equal(
      shouldAbandonRestoredSortie({
        restored: true,
        nav,
        activity: { asOf: "2026-10-11T14:41:00.000Z", sortie: open },
      }),
      false,
    );
    assert.equal(
      shouldAbandonRestoredSortie({
        restored: true,
        nav,
        activity: { asOf: "", sortie: null },
      }),
      false,
    );
    assert.equal(
      shouldAbandonRestoredSortie({
        restored: false,
        nav,
        activity: { asOf: "2026-10-11T14:41:00.000Z", sortie: null },
      }),
      false,
    );
    assert.equal(
      shouldAbandonRestoredSortie({
        restored: true,
        nav,
        activity: { asOf: "2026-10-11T14:41:00.000Z", sortie: null },
      }),
      true,
    );
    assert.equal(
      shouldAbandonRestoredSortie({
        restored: true,
        nav,
        activity: {
          asOf: "2026-10-11T15:00:00.000Z",
          sortie: sortie({ actualEnd: "2026-10-11T14:55:00.000Z" }),
        },
      }),
      true,
    );
    assert.equal(
      shouldAbandonRestoredSortie({
        restored: true,
        nav,
        activity: { asOf: "2026-10-11T14:41:00.000Z", sortie: sortie({ id: "sortie-2" }) },
      }),
      true,
    );
    assert.equal(
      shouldAbandonRestoredSortie({
        restored: true,
        nav: { mode: "browse" },
        activity: { asOf: "2026-10-11T14:41:00.000Z", sortie: null },
      }),
      false,
    );
  });

  it("holds an unsatisfied restored dwell until a fix, and lets a satisfied dwell stand", () => {
    assert.equal(shouldSettleRestoredDwell({ satisfied: false, seenFixSinceRestore: false }), false);
    assert.equal(shouldSettleRestoredDwell({ satisfied: false, seenFixSinceRestore: true }), true);
    assert.equal(shouldSettleRestoredDwell({ satisfied: true, seenFixSinceRestore: false }), true);
  });
});
