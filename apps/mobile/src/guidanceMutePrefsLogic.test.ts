import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultGuidanceMutePrefs,
  normalizeGuidanceMutePrefs,
  parseGuidanceMutePrefs,
  serializeGuidanceMutePrefs,
} from "./guidanceMutePrefsLogic.js";

describe("guidanceMutePrefs", () => {
  it("defaults to unmuted", () => {
    assert.deepEqual(defaultGuidanceMutePrefs, { muted: false });
    assert.deepEqual(normalizeGuidanceMutePrefs({ muted: true }), { muted: true });
    assert.deepEqual(normalizeGuidanceMutePrefs({ muted: false }), { muted: false });
  });

  it("parses stored json or falls back", () => {
    assert.deepEqual(parseGuidanceMutePrefs(JSON.stringify({ muted: true })), { muted: true });
    assert.deepEqual(parseGuidanceMutePrefs(JSON.stringify({ muted: false })), { muted: false });
    assert.equal(parseGuidanceMutePrefs(null), null);
    assert.equal(parseGuidanceMutePrefs(""), null);
    assert.equal(parseGuidanceMutePrefs("{"), null);
    assert.equal(parseGuidanceMutePrefs(JSON.stringify({ muted: "yes" })), null);
  });

  it("serializes preference for storage", () => {
    assert.equal(serializeGuidanceMutePrefs({ muted: true }), JSON.stringify({ muted: true }));
  });
});
