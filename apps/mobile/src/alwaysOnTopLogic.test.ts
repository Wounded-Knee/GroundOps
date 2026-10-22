import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { floatingRouteScale, isActiveNavigation, shouldAskAlwaysOnTopConsent } from "./alwaysOnTopLogic.js";

describe("always on top", () => {
  it("floats during guidance and arrival", () => {
    assert.equal(isActiveNavigation("guiding"), true);
    assert.equal(isActiveNavigation("arrived"), true);
    assert.equal(isActiveNavigation("browse"), false);
    assert.equal(isActiveNavigation("preview"), false);
    assert.equal(isActiveNavigation(""), false);
  });

  it("thins the route in the floating window", () => {
    assert.ok(floatingRouteScale > 0 && floatingRouteScale < 1);
  });

  it("asks for always-on-top consent once, until it is granted", () => {
    assert.equal(shouldAskAlwaysOnTopConsent({ granted: false, asked: false }), true);
    assert.equal(shouldAskAlwaysOnTopConsent({ granted: false, asked: true }), false);
    assert.equal(shouldAskAlwaysOnTopConsent({ granted: true, asked: false }), false);
    assert.equal(shouldAskAlwaysOnTopConsent({ granted: true, asked: true }), false);
  });
});
