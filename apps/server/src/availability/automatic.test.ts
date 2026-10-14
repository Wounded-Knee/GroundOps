import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeoCoordinate } from "@groundops/contracts";
import { automaticAvailabilityChoice, guidanceAvailabilityChoice, pointInGeofence } from "./automatic.js";

const square: GeoCoordinate[] = [
  { latitude: 0, longitude: 0 },
  { latitude: 0, longitude: 1 },
  { latitude: 1, longitude: 1 },
  { latitude: 1, longitude: 0 },
];

const flags = { autoSetUnavailable: true, autoSetAvailable: true };

describe("automatic availability", () => {
  it("sets unavailable only inside the lead before commencement", () => {
    assert.equal(automaticAvailabilityChoice({ event: "lead", withinLead: true, ...flags }), false);
    assert.equal(automaticAvailabilityChoice({ event: "lead", withinLead: false, ...flags }), null);
    assert.equal(
      automaticAvailabilityChoice({ event: "lead", withinLead: true, autoSetUnavailable: false, autoSetAvailable: true }),
      null,
    );
  });

  it("sets unavailable when a fare-bearing sortie commences", () => {
    assert.equal(
      automaticAvailabilityChoice({ event: "commencement", withinLead: false, fareBearing: true, ...flags }),
      false,
    );
    assert.equal(
      automaticAvailabilityChoice({
        event: "commencement",
        withinLead: false,
        fareBearing: true,
        autoSetUnavailable: false,
        autoSetAvailable: true,
      }),
      null,
    );
    assert.equal(
      automaticAvailabilityChoice({ event: "conclusion", withinLead: false, fareBearing: true, ...flags }),
      true,
    );
  });

  it("sets available when a sortie is commenced or concludes outside the lead", () => {
    assert.equal(automaticAvailabilityChoice({ event: "commencement", withinLead: false, ...flags }), true);
    assert.equal(automaticAvailabilityChoice({ event: "conclusion", withinLead: false, ...flags }), true);
    assert.equal(automaticAvailabilityChoice({ event: "commencement", withinLead: true, ...flags }), false);
    assert.equal(automaticAvailabilityChoice({ event: "conclusion", withinLead: true, ...flags }), false);
    assert.equal(
      automaticAvailabilityChoice({
        event: "commencement",
        withinLead: false,
        autoSetUnavailable: true,
        autoSetAvailable: false,
      }),
      null,
    );
    assert.equal(
      automaticAvailabilityChoice({
        event: "conclusion",
        withinLead: true,
        autoSetUnavailable: false,
        autoSetAvailable: true,
      }),
      true,
    );
  });

  it("sets unavailable when calendar guidance starts and that flag is on", () => {
    assert.equal(guidanceAvailabilityChoice({ withinLead: false, ...flags }), false);
    assert.equal(
      guidanceAvailabilityChoice({ withinLead: false, autoSetUnavailable: false, autoSetAvailable: true }),
      true,
    );
    assert.equal(
      guidanceAvailabilityChoice({ withinLead: true, autoSetUnavailable: false, autoSetAvailable: true }),
      true,
    );
    assert.equal(
      guidanceAvailabilityChoice({ withinLead: false, autoSetUnavailable: false, autoSetAvailable: false }),
      null,
    );
    assert.equal(
      automaticAvailabilityChoice({ event: "guidance", withinLead: false, autoSetUnavailable: false, autoSetAvailable: true }),
      null,
    );
  });

  it("treats a boundary point as inside and a short ring as no ring", () => {
    assert.equal(pointInGeofence({ latitude: 0.5, longitude: 0.5 }, square), true);
    assert.equal(pointInGeofence({ latitude: 2, longitude: 2 }, square), false);
    assert.equal(pointInGeofence({ latitude: 0, longitude: 0.5 }, square), true);
    assert.equal(pointInGeofence({ latitude: 0.5, longitude: 0.5 }, square.slice(0, 2)), false);
  });
});
