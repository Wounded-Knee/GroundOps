import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultTariff } from "@groundops/contracts";
import type { GeoCoordinate } from "@groundops/contracts";
import {
  advanceMeterAlongRoute,
  emptyMeter,
  formatMoney,
  gpsSilenceStationarySeconds,
  isStationary,
  meterCharges,
  progressFraction,
  resetMeterRouteProgress,
  stationaryDisplacementMeters,
  tickMeterWait,
} from "./meter";

const origin: GeoCoordinate = { latitude: 40, longitude: -74 };
const path: GeoCoordinate[] = [origin, north(origin, 1000), north(origin, 2000)];

describe("meter", () => {
  it("charges flag, distance, and wait from the tariff snapshot", () => {
    const charges = meterCharges(defaultTariff, 2, 90, 1609.344);
    assert.ok(charges);
    assert.equal(charges.flagCents, 300);
    assert.equal(charges.distanceCents, 500);
    assert.equal(charges.waitCents, 60);
    assert.equal(charges.totalCents, 860);
    assert.equal(charges.estimateCents, 860 + 250);
    assert.equal(formatMoney(charges.totalCents), "$8.60");
    assert.equal(meterCharges(null, 1, 0, 0), null);
  });

  it("decides stationary from GPS displacement, not device speed", () => {
    assert.equal(isStationary(0, 10), true);
    assert.equal(isStationary(stationaryDisplacementMeters, 1), true);
    assert.equal(isStationary(100, 10), false);
    assert.equal(isStationary(5, 10), true);
  });

  it("accumulates wait when GPS holds and miles from forward progress along the route", () => {
    const first = advanceMeterAlongRoute(emptyMeter(), {
      fix: origin,
      observedAtMs: 1_000,
      accuracyMeters: 10,
      routePath: path,
    });
    const waited = advanceMeterAlongRoute(first, {
      fix: origin,
      observedAtMs: 61_000,
      accuracyMeters: 10,
      routePath: path,
    });
    assert.ok(waited.waitSeconds >= 59);
    assert.equal(waited.milesTraveled, 0);
    assert.equal(waited.motion, "stationary");

    const moved = advanceMeterAlongRoute(waited, {
      fix: north(origin, 500),
      observedAtMs: 91_000,
      accuracyMeters: 10,
      routePath: path,
    });
    assert.ok(moved.milesTraveled > 0.3);
    assert.ok(moved.milesTraveled < 0.35);
    assert.equal(moved.waitSeconds, waited.waitSeconds);
    assert.equal(moved.motion, "moving");
  });

  it("does not add miles from off-route haversine displacement", () => {
    const onRoute = advanceMeterAlongRoute(emptyMeter(), {
      fix: origin,
      observedAtMs: 1_000,
      accuracyMeters: 10,
      routePath: path,
    });
    const off = advanceMeterAlongRoute(onRoute, {
      fix: east(origin, 200),
      observedAtMs: 11_000,
      accuracyMeters: 10,
      routePath: path,
    });
    assert.equal(off.milesTraveled, 0);
    assert.equal(off.motion, "moving");
  });

  it("does not subtract miles when along-route distance decreases", () => {
    const start = advanceMeterAlongRoute(emptyMeter(), {
      fix: origin,
      observedAtMs: 1_000,
      accuracyMeters: 10,
      routePath: path,
    });
    const forward = advanceMeterAlongRoute(start, {
      fix: north(origin, 800),
      observedAtMs: 21_000,
      accuracyMeters: 10,
      routePath: path,
    });
    const back = advanceMeterAlongRoute(forward, {
      fix: north(origin, 400),
      observedAtMs: 41_000,
      accuracyMeters: 10,
      routePath: path,
    });
    assert.equal(back.milesTraveled, forward.milesTraveled);
  });

  it("ticks wait once per second while parked, including before a second GPS fix", () => {
    const parked = advanceMeterAlongRoute(emptyMeter(), {
      fix: origin,
      observedAtMs: 1_000,
      accuracyMeters: 10,
      routePath: path,
    });
    assert.equal(parked.motion, "unknown");
    const firstTick = tickMeterWait(parked, 2_000);
    assert.ok(firstTick.waitSeconds >= 1);
    assert.equal(firstTick.motion, "stationary");
    const secondTick = tickMeterWait(firstTick, 3_000);
    assert.ok(secondTick.waitSeconds >= firstTick.waitSeconds + 1);

    const still = advanceMeterAlongRoute(parked, {
      fix: origin,
      observedAtMs: 2_000,
      accuracyMeters: 10,
      routePath: path,
    });
    assert.equal(still.motion, "stationary");
    const ticked = tickMeterWait(still, 32_000);
    assert.ok(ticked.waitSeconds >= 29);
    assert.equal(ticked.milesTraveled, 0);

    const moving = advanceMeterAlongRoute(still, {
      fix: north(origin, 100),
      observedAtMs: 12_000,
      accuracyMeters: 10,
      routePath: path,
    });
    assert.equal(moving.motion, "moving");
    assert.equal(
      tickMeterWait(moving, 12_000 + (gpsSilenceStationarySeconds * 1000 - 1)).waitSeconds,
      moving.waitSeconds,
    );
    const afterSilence = tickMeterWait(moving, 12_000 + gpsSilenceStationarySeconds * 1000);
    assert.ok(afterSilence.waitSeconds >= moving.waitSeconds + gpsSilenceStationarySeconds);
    assert.equal(afterSilence.motion, "stationary");
  });

  it("ignores inaccurate fixes and measures progress from remaining versus baseline", () => {
    const started = advanceMeterAlongRoute(emptyMeter(), {
      fix: origin,
      observedAtMs: 1_000,
      accuracyMeters: 10,
      routePath: path,
    });
    const ignored = advanceMeterAlongRoute(started, {
      fix: north(origin, 500),
      observedAtMs: 2_000,
      accuracyMeters: 80,
      routePath: path,
    });
    assert.equal(ignored.milesTraveled, started.milesTraveled);
    assert.equal(progressFraction(1609.344, 1609.344), 0);
    assert.equal(progressFraction(0, 1609.344), 1);
    assert.equal(progressFraction(0, 0), 1);
    assert.ok(progressFraction(800, 1609.344) > 0.4);
    assert.ok(progressFraction(800, 1609.344) < 0.6);
    assert.equal(progressFraction(2000, 1609.344), 0);
  });

  it("resets along-route tracking without clearing miles or wait", () => {
    const state = {
      milesTraveled: 1.5,
      waitSeconds: 40,
      last: {
        fix: origin,
        observedAtMs: 1_000,
        accuracyMeters: 10,
      },
      alongMeters: 900,
      motion: "moving" as const,
    };
    const reset = resetMeterRouteProgress(state, 10);
    assert.equal(reset.milesTraveled, 1.5);
    assert.equal(reset.waitSeconds, 40);
    assert.equal(reset.alongMeters, 10);
  });
});

function north(from: GeoCoordinate, meters: number): GeoCoordinate {
  return { latitude: from.latitude + meters / 111_320, longitude: from.longitude };
}

function east(from: GeoCoordinate, meters: number): GeoCoordinate {
  return { latitude: from.latitude, longitude: from.longitude + meters / (111_320 * Math.cos((from.latitude * Math.PI) / 180)) };
}
