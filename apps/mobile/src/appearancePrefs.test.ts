import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultAppearancePreference,
  normalizeAppearancePreference,
  parseAppearancePreference,
  serializeAppearancePreference,
} from "./appearancePrefsLogic.js";

describe("appearancePrefs", () => {
  it("defaults to system", () => {
    assert.equal(defaultAppearancePreference, "system");
    assert.equal(normalizeAppearancePreference("light"), "light");
    assert.equal(normalizeAppearancePreference("dark"), "dark");
    assert.equal(normalizeAppearancePreference("system"), "system");
  });

  it("parses stored json or falls back", () => {
    assert.equal(parseAppearancePreference(JSON.stringify({ preference: "dark" })), "dark");
    assert.equal(parseAppearancePreference(JSON.stringify({ preference: "light" })), "light");
    assert.equal(parseAppearancePreference(JSON.stringify({ preference: "system" })), "system");
    assert.equal(parseAppearancePreference(null), null);
    assert.equal(parseAppearancePreference(""), null);
    assert.equal(parseAppearancePreference("{"), null);
    assert.equal(parseAppearancePreference(JSON.stringify({ preference: "neon" })), null);
  });

  it("serializes preference for storage", () => {
    assert.equal(serializeAppearancePreference("dark"), JSON.stringify({ preference: "dark" }));
  });
});
