import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultVisualAlertPrefs,
  normalizeHexColor,
  normalizeVisualAlertPrefs,
  parseVisualAlertPrefs,
  serializeVisualAlertPrefs,
} from "./visualAlertPrefsLogic.js";

describe("visualAlertPrefs", () => {
  it("defaults to off with alert red and 10% intensity", () => {
    assert.deepEqual(defaultVisualAlertPrefs, {
      enabled: false,
      color: "#FF3B30",
      intensity: 0.1,
      brightness: 0.7,
    });
  });

  it("normalizes hex colors", () => {
    assert.equal(normalizeHexColor("#f00"), "#FF0000");
    assert.equal(normalizeHexColor("#aabbcc"), "#AABBCC");
    assert.equal(normalizeHexColor("  #AbC  "), "#AABBCC");
    assert.equal(normalizeHexColor("ff0000"), null);
    assert.equal(normalizeHexColor("#gg0000"), null);
    assert.equal(normalizeHexColor("#12345"), null);
  });

  it("clamps intensity and brightness", () => {
    assert.deepEqual(
      normalizeVisualAlertPrefs({
        enabled: true,
        color: "#abc",
        intensity: 2,
        brightness: -1,
      }),
      { enabled: true, color: "#AABBCC", intensity: 1, brightness: 0 },
    );
  });

  it("parses stored json or falls back", () => {
    const raw = JSON.stringify({
      enabled: true,
      color: "#00ff00",
      intensity: 0.25,
      brightness: 0.5,
    });
    assert.deepEqual(parseVisualAlertPrefs(raw), {
      enabled: true,
      color: "#00FF00",
      intensity: 0.25,
      brightness: 0.5,
    });
    assert.equal(parseVisualAlertPrefs(null), null);
    assert.equal(parseVisualAlertPrefs(""), null);
    assert.equal(parseVisualAlertPrefs("{"), null);
    assert.equal(
      parseVisualAlertPrefs(JSON.stringify({ enabled: true, color: "red", intensity: 0.1, brightness: 0.5 })),
      null,
    );
  });

  it("serializes prefs for storage", () => {
    assert.equal(
      serializeVisualAlertPrefs({
        enabled: true,
        color: "#f00",
        intensity: 0.2,
        brightness: 0.8,
      }),
      JSON.stringify({
        enabled: true,
        color: "#FF0000",
        intensity: 0.2,
        brightness: 0.8,
      }),
    );
  });
});
