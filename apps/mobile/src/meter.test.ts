import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultTariff } from "@groundops/contracts";
import {
  advanceMeter,
  emptyMeter,
  formatMoney,
  isStationary,
  meterCharges,
  progressFraction,
  stationaryDisplacementMeters,
  tickMeterWait,
} from "./meter";

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

  it("accumulates wait when GPS position holds and miles when it moves", () => {
    const first = advanceMeter(emptyMeter(), {
      fix: { latitude: 40, longitude: -74 },
      observedAtMs: 1_000,
      accuracyMeters: 10,
    });
    const waited = advanceMeter(first, {
      fix: { latitude: 40, longitude: -74 },
      observedAtMs: 61_000,
      accuracyMeters: 10,
    });
    assert.ok(waited.waitSeconds >= 59);
    assert.equal(waited.milesTraveled, 0);

    const moved = advanceMeter(waited, {
      fix: { latitude: 40.01, longitude: -74 },
      observedAtMs: 91_000,
      accuracyMeters: 10,
    });
    assert.ok(moved.milesTraveled > 0);
    assert.equal(moved.waitSeconds, waited.waitSeconds);
  });

  it("keeps accumulating wait when location callbacks pause", () => {
    const parked = advanceMeter(emptyMeter(), {
      fix: { latitude: 40, longitude: -74 },
      observedAtMs: 1_000,
      accuracyMeters: 10,
    });
    const ticked = tickMeterWait(parked, 31_000);
    assert.ok(ticked.waitSeconds >= 29);
    assert.equal(ticked.milesTraveled, 0);
  });

  it("ignores inaccurate fixes and shrinks progress when remaining grows after a detour", () => {
    const started = advanceMeter(emptyMeter(), {
      fix: { latitude: 40, longitude: -74 },
      observedAtMs: 1_000,
      accuracyMeters: 10,
    });
    const ignored = advanceMeter(started, {
      fix: { latitude: 40.02, longitude: -74 },
      observedAtMs: 2_000,
      accuracyMeters: 80,
    });
    assert.equal(ignored.milesTraveled, started.milesTraveled);
    assert.equal(progressFraction(0, 1609.344), 0);
    assert.equal(progressFraction(1, 0), 1);
    const beforeDetour = progressFraction(1, 1609.344);
    const afterDetour = progressFraction(5, 8 * 1609.344);
    assert.ok(afterDetour < beforeDetour);
  });
});
