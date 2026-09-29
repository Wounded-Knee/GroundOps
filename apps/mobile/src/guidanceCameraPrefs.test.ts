import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultGuidanceCameraPrefs,
  normalizeGuidanceCameraPrefs,
  parseGuidanceCameraFields,
  parseGuidanceCameraPrefs,
} from "./guidanceCameraPrefsLogic.js";

describe("guidanceCameraPrefs", () => {
  it("parses and clamps zoom and tilt", () => {
    assert.deepEqual(parseGuidanceCameraFields("17.5", "50"), { zoom: 17.5, tilt: 50 });
    assert.deepEqual(normalizeGuidanceCameraPrefs({ zoom: 3, tilt: 120 }), { zoom: 10, tilt: 67.5 });
    assert.deepEqual(normalizeGuidanceCameraPrefs({ zoom: 25, tilt: -5 }), { zoom: 20, tilt: 0 });
    assert.equal(parseGuidanceCameraFields("", "50"), null);
    assert.equal(parseGuidanceCameraFields("17.5", "tilt"), null);
  });

  it("parses stored json or falls back", () => {
    assert.deepEqual(parseGuidanceCameraPrefs(JSON.stringify({ zoom: 16, tilt: 40 })), {
      zoom: 16,
      tilt: 40,
    });
    assert.equal(parseGuidanceCameraPrefs(null), null);
    assert.equal(parseGuidanceCameraPrefs("{"), null);
    assert.equal(defaultGuidanceCameraPrefs.zoom, 17.5);
    assert.equal(defaultGuidanceCameraPrefs.tilt, 50);
  });
});
