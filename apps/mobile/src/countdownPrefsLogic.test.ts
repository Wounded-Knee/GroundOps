import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countdownLeadFromIndex,
  countdownLeadIndex,
  countdownLeadRangeLabel,
  defaultCountdownLeadMinutes,
  formatCountdownLead,
  normalizeCountdownLeadMinutes,
  parseCountdownLeadMinutes,
  serializeCountdownLeadMinutes,
} from "./countdownPrefsLogic.js";

describe("countdownPrefs", () => {
  it("defaults to 30 minutes and labels each step", () => {
    assert.equal(defaultCountdownLeadMinutes, 30);
    assert.equal(formatCountdownLead(null), "Off");
    assert.equal(formatCountdownLead(120), "120");
    assert.equal(countdownLeadRangeLabel, "Off, 15, 30, 45, 60, 120");
  });

  it("maps slider indexes onto the discrete steps", () => {
    assert.equal(countdownLeadIndex(null), 0);
    assert.equal(countdownLeadIndex(15), 1);
    assert.equal(countdownLeadIndex(120), 5);
    assert.equal(countdownLeadFromIndex(0), null);
    assert.equal(countdownLeadFromIndex(3.2), 45);
    assert.equal(countdownLeadFromIndex(99), 30);
  });

  it("parses stored json or falls back", () => {
    assert.equal(parseCountdownLeadMinutes(JSON.stringify({ leadMinutes: null })), null);
    assert.equal(parseCountdownLeadMinutes(JSON.stringify({ leadMinutes: 60 })), 60);
    assert.equal(parseCountdownLeadMinutes(JSON.stringify({ leadMinutes: 20 })), undefined);
    assert.equal(parseCountdownLeadMinutes(null), undefined);
    assert.equal(parseCountdownLeadMinutes("{"), undefined);
    assert.equal(normalizeCountdownLeadMinutes(45), 45);
    assert.equal(normalizeCountdownLeadMinutes(10), 30);
    assert.equal(serializeCountdownLeadMinutes(null), JSON.stringify({ leadMinutes: null }));
  });
});
