import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { departureAlertRequests, departureCollapseTag } from "./departureAlertRequests";

describe("departureAlertRequests", () => {
  const next = {
    sortieId: "soon",
    departAt: new Date("2026-09-02T12:10:00.000Z"),
    label: "Soon stop",
  };

  it("schedules each remaining mark under its own id and one tray tag", () => {
    const requests = departureAlertRequests(next, new Date("2026-09-02T12:00:00.000Z"));
    assert.deepEqual(
      requests.map((request) => request.identifier),
      ["groundops-depart-5", "groundops-depart-1", "groundops-depart-0"],
    );
    assert.equal(new Set(requests.map((request) => request.identifier)).size, requests.length);
    assert.deepEqual(
      requests.map((request) => request.collapseTag),
      [departureCollapseTag, departureCollapseTag, departureCollapseTag],
    );
    assert.deepEqual(
      requests.map((request) => request.title),
      ["Depart in 5 minutes", "Depart in 1 minute", "Departure time"],
    );
    assert.ok(requests.every((request) => request.body === "Depart for Soon stop"));
  });

  it("omits marks that have already passed", () => {
    const requests = departureAlertRequests(next, new Date("2026-09-02T12:06:00.000Z"));
    assert.deepEqual(
      requests.map((request) => request.identifier),
      ["groundops-depart-1", "groundops-depart-0"],
    );
    assert.ok(requests.every((request) => request.collapseTag === departureCollapseTag));
  });
});
