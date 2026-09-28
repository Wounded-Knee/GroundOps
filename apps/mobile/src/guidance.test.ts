import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DrivingRoute, GeoCoordinate, RouteStep } from "@groundops/contracts";
import {
  applyLocationFix,
  formatMeters,
  formatSeconds,
  remainingDistanceMeters,
  remainingDurationSeconds,
} from "./guidance.js";

const origin: GeoCoordinate = { latitude: 0, longitude: 0 };

describe("guidance", () => {
  it("advances only the current step when one fix is within 30 meters of more than one step end", () => {
    const destination = north(origin, 200);
    const route = routeWithEnds(20, 5);
    const secondEnd = route.path[route.path.length - 1] ?? destination;
    route.steps.push(step(secondEnd, destination, 175, 40));
    route.path.push(destination);

    const first = applyLocationFix({
      fix: origin,
      destination,
      route,
      stepIndex: 0,
      now: 0,
      offRouteSince: null,
      rerouteInFlight: false,
    });
    assert.equal(first.arrived, false);
    assert.equal(first.stepIndex, 1);
  });

  it("arrives inside 40 meters of the destination before advancing a step", () => {
    const route = routeWithEnds(20, 10);
    const destination = north(origin, 15);
    const result = applyLocationFix({
      fix: origin,
      destination,
      route,
      stepIndex: 0,
      now: 0,
      offRouteSince: null,
      rerouteInFlight: false,
    });
    assert.equal(result.arrived, true);
    assert.equal(result.stepIndex, 0);
    assert.equal(result.shouldReroute, false);
  });

  it("requests a reroute only after 5 seconds off the path", () => {
    const route = routeWithEnds(500, 500);
    const off = east(origin, 80);
    const started = applyLocationFix({
      fix: off,
      destination: north(origin, 1000),
      route,
      stepIndex: 0,
      now: 1_000,
      offRouteSince: null,
      rerouteInFlight: false,
    });
    assert.equal(started.shouldReroute, false);
    assert.equal(started.offRouteSince, 1_000);

    const waiting = applyLocationFix({
      fix: off,
      destination: north(origin, 1000),
      route,
      stepIndex: 0,
      now: 5_999,
      offRouteSince: started.offRouteSince,
      rerouteInFlight: false,
    });
    assert.equal(waiting.shouldReroute, false);

    const due = applyLocationFix({
      fix: off,
      destination: north(origin, 1000),
      route,
      stepIndex: 0,
      now: 6_000,
      offRouteSince: started.offRouteSince,
      rerouteInFlight: false,
    });
    assert.equal(due.shouldReroute, true);

    const inFlight = applyLocationFix({
      fix: off,
      destination: north(origin, 1000),
      route,
      stepIndex: 0,
      now: 7_000,
      offRouteSince: started.offRouteSince,
      rerouteInFlight: true,
    });
    assert.equal(inFlight.shouldReroute, false);
    assert.equal(inFlight.offRouteSince, 1_000);

    const returned = applyLocationFix({
      fix: origin,
      destination: north(origin, 1000),
      route,
      stepIndex: 0,
      now: 2_000,
      offRouteSince: 1_000,
      rerouteInFlight: false,
    });
    assert.equal(returned.offRouteSince, null);
    assert.equal(returned.shouldReroute, false);
  });

  it("computes remaining distance and time from the current step", () => {
    const route = routeWithEnds(100, 50);
    const fix = north(origin, 75);
    assert.ok(Math.abs(remainingDistanceMeters(fix, route, 0) - 75) < 2);
    assert.ok(Math.abs(remainingDurationSeconds(fix, route, 0) - 65) < 1);
    assert.equal(formatMeters(850), "850 m");
    assert.equal(formatMeters(1500), "1.5 km");
    assert.equal(formatSeconds(90), "2 min");
    assert.equal(formatSeconds(5400), "1 hr 30 min");
  });
});

function routeWithEnds(firstMeters: number, secondMeters: number): DrivingRoute {
  const firstEnd = north(origin, firstMeters);
  const secondEnd = north(origin, firstMeters + secondMeters);
  const first = step(origin, firstEnd, firstMeters, 100);
  const second = step(firstEnd, secondEnd, secondMeters, 40);
  return {
    distanceMeters: firstMeters + secondMeters,
    durationSeconds: 140,
    path: [origin, firstEnd, secondEnd],
    steps: [first, second],
  };
}

function step(start: GeoCoordinate, end: GeoCoordinate, distance: number, duration: number): RouteStep {
  return {
    instruction: "Continue",
    maneuver: "straight",
    distanceMeters: distance,
    durationSeconds: duration,
    path: [start, end],
  };
}

function north(from: GeoCoordinate, meters: number): GeoCoordinate {
  return { latitude: from.latitude + meters / 111_320, longitude: from.longitude };
}

function east(from: GeoCoordinate, meters: number): GeoCoordinate {
  return { latitude: from.latitude, longitude: from.longitude + meters / 111_320 };
}
