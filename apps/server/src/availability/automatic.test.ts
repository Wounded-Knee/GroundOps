import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { automaticAvailabilityChoice } from "./automatic.js";

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
});
