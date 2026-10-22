import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeoCoordinate } from "@groundops/contracts";
import { parsePlaceQuery } from "./placeQuery.js";

const near = (left: number, right: number): void => {
  assert.ok(Math.abs(left - right) < 1e-8, `${left} is not near ${right}`);
};

function expectCoordinate(query: string, latitude: number, longitude: number, bias?: GeoCoordinate): void {
  const place = parsePlaceQuery(query, bias);
  assert.ok(place, query);
  near(place.latitude, latitude);
  near(place.longitude, longitude);
}

describe("place query", () => {
  it("reads decimal coordinates in the forms people paste", () => {
    expectCoordinate("40.7128, -74.006", 40.7128, -74.006);
    expectCoordinate("40.7128 -74.006", 40.7128, -74.006);
    expectCoordinate("(40.7128, -74.006)", 40.7128, -74.006);
    expectCoordinate("[40.7128, -74.006]", 40.7128, -74.006);
    expectCoordinate("40.7128/-74.006", 40.7128, -74.006);
    expectCoordinate("40.7128, -74.006, 12", 40.7128, -74.006);
    expectCoordinate("40,7128; -74,0060", 40.7128, -74.006);
    expectCoordinate("120.5, 40.7128", 40.7128, 120.5);
  });

  it("reads hemispheres, labels, and sexagesimal angles", () => {
    expectCoordinate("40.7128 N, 74.006 W", 40.7128, -74.006);
    expectCoordinate("N 40.7128, W 74.006", 40.7128, -74.006);
    expectCoordinate("lat: 40.7128 lng: -74.006", 40.7128, -74.006);
    expectCoordinate("longitude -74.006, latitude 40.7128", 40.7128, -74.006);
    expectCoordinate('40°26\'46"N 79°58\'56"W', 40 + 26 / 60 + 46 / 3600, -(79 + 58 / 60 + 56 / 3600));
    expectCoordinate("40 26 46 N, 79 58 56 W", 40 + 26 / 60 + 46 / 3600, -(79 + 58 / 60 + 56 / 3600));
    expectCoordinate("40 26.767 N, 79 58.933 W", 40 + 26.767 / 60, -(79 + 58.933 / 60));
    expectCoordinate("40d26m46sN 79d58m56sW", 40 + 26 / 60 + 46 / 3600, -(79 + 58 / 60 + 56 / 3600));
    expectCoordinate("N40.7128 W74.006", 40.7128, -74.006);
    expectCoordinate("N40°42.77' W74°00.36'", 40 + 42.77 / 60, -(74 + 0.36 / 60));
    expectCoordinate("40°26.7717 N 79°58.9317 W", 40 + 26.7717 / 60, -(79 + 58.9317 / 60));
    expectCoordinate("40.7128, -74.006 (New York)", 40.7128, -74.006);
  });

  it("reads geo URIs, map links, GeoJSON, and WKT", () => {
    expectCoordinate("geo:40.7128,-74.006,18", 40.7128, -74.006);
    expectCoordinate("https://www.google.com/maps/@40.7128,-74.006,15z", 40.7128, -74.006);
    expectCoordinate("https://maps.google.com/?q=40.7128,-74.006", 40.7128, -74.006);
    expectCoordinate("https://www.google.com/maps/place/data=!3d40.7128!4d-74.006", 40.7128, -74.006);
    expectCoordinate("https://maps.apple.com/?ll=40.7128,-74.006", 40.7128, -74.006);
    expectCoordinate("https://www.openstreetmap.org/#map=15/40.7128/-74.006", 40.7128, -74.006);
    expectCoordinate('{"type":"Point","coordinates":[-74.006,40.7128]}', 40.7128, -74.006);
    expectCoordinate("POINT(-74.006 40.7128)", 40.7128, -74.006);
    expectCoordinate("SRID=4326;POINT(-74.006 40.7128)", 40.7128, -74.006);
    expectCoordinate("https://maps.google.com/maps?q=loc:40.7128,-74.006", 40.7128, -74.006);
    expectCoordinate(
      "https://www.google.com/maps/place/X/@40.7,-74,17z/data=!3d40.7128!4d-74.006",
      40.7128,
      -74.006,
    );
  });

  it("decodes full plus codes to the center of the cell", () => {
    const samples: Array<[string, number, number, number, number]> = [
      ["7FG49Q00+", 20.35, 20.4, 2.75, 2.8],
      ["7FG49QCJ+2V", 20.37, 20.370125, 2.782125, 2.78225],
      ["7FG49QCJ+2VX", 20.3701, 20.370125, 2.78221875, 2.78225],
      ["8FVC2222+22", 47, 47.000125, 8, 8.000125],
      ["4VCPPQGP+Q9", -41.273125, -41.273, 174.785875, 174.786],
      ["22220000+", -90, -89, -180, -179],
      ["6VGX0000+", 0, 1, 179, 180],
    ];
    for (const [code, latLo, latHi, lngLo, lngHi] of samples) {
      expectCoordinate(code, (latLo + latHi) / 2, (lngLo + lngHi) / 2);
      expectCoordinate(`${code.toLowerCase()} near here`, (latLo + latHi) / 2, (lngLo + lngHi) / 2);
    }
  });

  it("recovers a short plus code from the nearby reference", () => {
    const full = parsePlaceQuery("9C3W9QCJ+2VX");
    assert.ok(full);
    const recovered = parsePlaceQuery("+2VX", { latitude: 51.3701125, longitude: -1.217765625 });
    assert.equal(recovered?.label, "9C3W9QCJ+2VX");
    near(recovered?.latitude ?? 0, full.latitude);
    near(recovered?.longitude ?? 0, full.longitude);
    assert.equal(parsePlaceQuery("+2VX"), null);
    assert.equal(parsePlaceQuery("CJ+2VX London"), null);
  });

  it("leaves ordinary addresses alone", () => {
    assert.equal(parsePlaceQuery("123 Main St, Springfield"), null);
    assert.equal(parsePlaceQuery("New York"), null);
    assert.equal(parsePlaceQuery(""), null);
    assert.equal(parsePlaceQuery("91, 181"), null);
  });
});
