import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultGuidanceTimingPrefs,
  normalizeGuidanceTimingPrefs,
  parseGuidanceTimingFields,
  parseGuidanceTimingPrefs,
} from "./guidanceTimingPrefsLogic.js";

describe("guidanceTimingPrefs", () => {
  it("parses and clamps announce lead and step advance", () => {
    assert.deepEqual(parseGuidanceTimingFields("250", "30"), {
      announceLeadMeters: 250,
      stepAdvanceMeters: 30,
    });
    assert.deepEqual(normalizeGuidanceTimingPrefs({ announceLeadMeters: 10, stepAdvanceMeters: 200 }), {
      announceLeadMeters: 50,
      stepAdvanceMeters: 100,
    });
    assert.deepEqual(normalizeGuidanceTimingPrefs({ announceLeadMeters: 2000, stepAdvanceMeters: 1 }), {
      announceLeadMeters: 1000,
      stepAdvanceMeters: 10,
    });
    assert.equal(parseGuidanceTimingFields("", "30"), null);
    assert.equal(parseGuidanceTimingFields("250", "advance"), null);
  });

  it("parses stored json or falls back", () => {
    assert.deepEqual(
      parseGuidanceTimingPrefs(JSON.stringify({ announceLeadMeters: 400, stepAdvanceMeters: 40 })),
      {
        announceLeadMeters: 400,
        stepAdvanceMeters: 40,
      },
    );
    assert.equal(parseGuidanceTimingPrefs(null), null);
    assert.equal(parseGuidanceTimingPrefs("{"), null);
    assert.equal(defaultGuidanceTimingPrefs.announceLeadMeters, 250);
    assert.equal(defaultGuidanceTimingPrefs.stepAdvanceMeters, 30);
  });
});
