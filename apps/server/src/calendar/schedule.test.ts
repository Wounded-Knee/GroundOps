import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anchorAwayFromCompletedTerminal,
  anchorAwayFromPickup,
  approachOrigin,
  placeStillOpen,
  type SortiePlace,
} from "./schedule.js";

const now = new Date("2026-10-14T15:33:52.000Z");
const airport = { latitude: 34.267045, longitude: -77.910467 };
const castleHayne = { latitude: 34.2892725, longitude: -77.9210429 };
const south17th = { latitude: 34.227629, longitude: -77.926208 };

function place(overrides: Partial<SortiePlace> & Pick<SortiePlace, "id" | "arrivalAt">): SortiePlace {
  return {
    scheduledEnd: overrides.arrivalAt,
    actualStart: null,
    actualEnd: null,
    destination: airport,
    destinationLabel: "Airport Boulevard",
    ...overrides,
  };
}

describe("placeStillOpen", () => {
  it("keeps the latest commenced sortie open after its scheduled end", () => {
    const ilm = place({
      id: "ilm",
      arrivalAt: new Date("2026-10-14T15:33:50.000Z"),
      scheduledEnd: new Date("2026-10-14T15:33:50.000Z"),
      actualStart: new Date("2026-10-14T15:11:48.000Z"),
      destinationLabel: "Airport Boulevard",
    });
    const oilChange = place({
      id: "oil",
      arrivalAt: new Date("2026-10-14T16:30:00.000Z"),
      destination: south17th,
      destinationLabel: "South 17th Street",
    });
    const places = [ilm, oilChange];

    assert.equal(placeStillOpen(ilm, now, places), true);
    const origin = approachOrigin(places, oilChange.arrivalAt, oilChange.id, castleHayne, now);
    assert.equal(origin?.label, "Airport Boulevard");
    assert.equal(origin?.latitude, airport.latitude);
  });

  it("drops a commenced sortie once a later sortie has been commenced", () => {
    const abandoned = place({
      id: "abandoned",
      arrivalAt: new Date("2026-10-13T21:33:00.000Z"),
      scheduledEnd: new Date("2026-10-13T21:33:00.000Z"),
      actualStart: new Date("2026-10-13T21:20:00.000Z"),
      destination: castleHayne,
      destinationLabel: "Castle Hayne Road",
    });
    const ilm = place({
      id: "ilm",
      arrivalAt: new Date("2026-10-14T15:33:50.000Z"),
      scheduledEnd: new Date("2026-10-14T15:33:50.000Z"),
      actualStart: new Date("2026-10-14T15:11:48.000Z"),
      actualEnd: new Date("2026-10-14T15:39:29.000Z"),
      destinationLabel: "Airport Boulevard",
    });
    const oilChange = place({
      id: "oil",
      arrivalAt: new Date("2026-10-14T16:30:00.000Z"),
      destination: south17th,
      destinationLabel: "South 17th Street",
    });
    const places = [abandoned, ilm, oilChange];

    assert.equal(placeStillOpen(abandoned, now, places), false);
    assert.equal(placeStillOpen(ilm, now, places), false);
    const origin = approachOrigin(places, oilChange.arrivalAt, oilChange.id, airport, now);
    assert.equal(origin?.label, null);
    assert.equal(origin?.latitude, airport.latitude);
  });
});

describe("anchorAwayFromCompletedTerminal", () => {
  it("is true when the driver is at the completed terminal and the anchor is the mid-route fix", () => {
    const ilm = place({
      id: "ilm",
      arrivalAt: new Date("2026-10-14T15:33:50.000Z"),
      actualStart: new Date("2026-10-14T15:11:48.000Z"),
      actualEnd: new Date("2026-10-14T15:39:29.000Z"),
      destination: airport,
      destinationLabel: "Airport Boulevard",
    });
    const gps = { latitude: 34.2663335, longitude: -77.9139723 };

    assert.equal(anchorAwayFromCompletedTerminal([ilm], castleHayne, gps), true);
    assert.equal(anchorAwayFromCompletedTerminal([ilm], gps, gps), false);
  });
});

describe("anchorAwayFromPickup", () => {
  const hall = { latitude: 34.274802, longitude: -77.9182343 };
  const independence = { latitude: 34.2155255, longitude: -77.9081711 };
  const atTerminal = { latitude: 34.267558, longitude: -77.912007 };
  const backAtTerminal = { latitude: 34.2665633, longitude: -77.9135671 };

  it("is true when the driver is at the next stop and the cached origin is another street", () => {
    assert.equal(anchorAwayFromPickup(hall, atTerminal, airport), true);
    assert.equal(anchorAwayFromPickup(independence, backAtTerminal, airport), true);
  });

  it("stays false while the driver is away from the next stop", () => {
    assert.equal(anchorAwayFromPickup(independence, hall, airport), false);
    assert.equal(anchorAwayFromPickup(atTerminal, atTerminal, airport), false);
  });
});
