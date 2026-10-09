import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DrivingRoute, GeoCoordinate, RouteStep } from "@groundops/contracts";
import {
  applyLocationFix,
  bearingAlongPath,
  bearingDeltaDegrees,
  distanceMeters,
  distanceToUpcomingManeuver,
  formatMeters,
  formatSeconds,
  guidanceLookAheadMeters,
  noteRouteFix,
  offsetAlongBearing,
  pathLengthMeters,
  pointAlongPath,
  poseAt,
  projectOntoPath,
  remainingDistanceMeters,
  remainingDurationSeconds,
  shouldAnnounceUpcoming,
  smoothBearing,
  stepAdvanceMeters,
  upcomingStep,
  upcomingStepIndex,
  type RouteMotion,
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
      stepAdvanceMeters,
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
      stepAdvanceMeters,
    });
    assert.equal(result.arrived, true);
    assert.equal(result.stepIndex, 0);
    assert.equal(result.shouldReroute, false);
  });

  it("uses the supplied step advance distance", () => {
    const route = routeWithEnds(80, 100);
    const destination = north(origin, 200);
    const far = applyLocationFix({
      fix: origin,
      destination,
      route,
      stepIndex: 0,
      now: 0,
      offRouteSince: null,
      rerouteInFlight: false,
      stepAdvanceMeters: 30,
    });
    assert.equal(far.stepIndex, 0);

    const near = applyLocationFix({
      fix: origin,
      destination,
      route,
      stepIndex: 0,
      now: 0,
      offRouteSince: null,
      rerouteInFlight: false,
      stepAdvanceMeters: 100,
    });
    assert.equal(near.stepIndex, 1);
  });

  it("selects the upcoming maneuver and announce window", () => {
    const route = routeWithEnds(500, 200);
    assert.equal(upcomingStepIndex(route, 0), 1);
    assert.equal(upcomingStep(route, 0), route.steps[1]);
    assert.equal(upcomingStepIndex(route, 1), 1);
    assert.equal(upcomingStep(route, 1), route.steps[1]);
    const distance = distanceToUpcomingManeuver(origin, route, 0);
    assert.ok(Math.abs(distance - 500) < 2);
    assert.equal(shouldAnnounceUpcoming(500, 250), false);
    assert.equal(shouldAnnounceUpcoming(250, 250), true);
    assert.equal(shouldAnnounceUpcoming(80, 250), true);
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
      stepAdvanceMeters,
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
      stepAdvanceMeters,
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
      stepAdvanceMeters,
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
      stepAdvanceMeters,
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
      stepAdvanceMeters,
    });
    assert.equal(returned.offRouteSince, null);
    assert.equal(returned.shouldReroute, false);
  });

  it("computes remaining distance along the route path and duration from the current step", () => {
    const route = routeWithEnds(100, 50);
    const fix = north(origin, 75);
    assert.ok(Math.abs(pathLengthMeters(route.path) - 150) < 2);
    const projection = projectOntoPath(fix, route.path);
    assert.ok(Math.abs(projection.alongMeters - 75) < 2);
    assert.ok(Math.abs(projection.remainingMeters - 75) < 2);
    assert.ok(projection.distanceToPathMeters < 1);
    assert.ok(Math.abs(remainingDistanceMeters(fix, route, 0) - 75) < 2);
    assert.ok(Math.abs(remainingDurationSeconds(fix, route, 0) - 65) < 1);
    assert.equal(formatMeters(850), "850 m");
    assert.equal(formatMeters(1500), "1.5 km");
    assert.equal(formatSeconds(90), "2 min");
    assert.equal(formatSeconds(5400), "1 hr 30 min");
  });

  it("projects a point onto a bent path using along-route distance", () => {
    const corner = north(origin, 100);
    const end = east(corner, 100);
    const path = [origin, corner, end];
    assert.ok(Math.abs(pathLengthMeters(path) - 200) < 2);
    const midway = north(origin, 50);
    const first = projectOntoPath(midway, path);
    assert.ok(Math.abs(first.alongMeters - 50) < 2);
    assert.ok(Math.abs(first.remainingMeters - 150) < 2);
    const onSecond = east(corner, 40);
    const second = projectOntoPath(onSecond, path);
    assert.ok(Math.abs(second.alongMeters - 140) < 3);
    assert.ok(Math.abs(second.remainingMeters - 60) < 3);
  });

  it("offsets along bearing north and east by the requested meters", () => {
    const northTarget = offsetAlongBearing(origin, 0, guidanceLookAheadMeters);
    assert.ok(Math.abs(distanceMeters(origin, northTarget) - guidanceLookAheadMeters) < 1);
    assert.ok(northTarget.latitude > origin.latitude);
    assert.ok(Math.abs(northTarget.longitude - origin.longitude) < 1e-9);

    const eastTarget = offsetAlongBearing(origin, 90, guidanceLookAheadMeters);
    assert.ok(Math.abs(distanceMeters(origin, eastTarget) - guidanceLookAheadMeters) < 1);
    assert.ok(eastTarget.longitude > origin.longitude);
    assert.ok(Math.abs(eastTarget.latitude - origin.latitude) < 1e-9);
  });

  it("places a point and its travel bearing along a bent path", () => {
    const corner = north(origin, 100);
    const end = east(corner, 100);
    const path = [origin, corner, end];
    const midway = pointAlongPath(path, 50);
    assert.ok(midway);
    assert.ok(Math.abs(distanceMeters(midway, north(origin, 50))) < 2);
    assert.ok(Math.abs((bearingAlongPath(path, 50) ?? -1) - 0) < 1);
    const pastCorner = pointAlongPath(path, 140);
    assert.ok(pastCorner);
    assert.ok(Math.abs(distanceMeters(pastCorner, east(corner, 40))) < 3);
    assert.ok(Math.abs((bearingAlongPath(path, 140) ?? -1) - 90) < 1);
    const clamped = pointAlongPath(path, 10_000);
    assert.ok(clamped);
    assert.ok(distanceMeters(clamped, end) < 1);
  });

  it("eases toward a new fix instead of teleporting the displayed pose", () => {
    const path = [origin, north(origin, 1_000)];
    let motion = noteRouteFix(null, { at: origin, speedMps: 0, bearing: 0, timeMs: 0, path });
    motion = noteRouteFix(motion, { at: north(origin, 100), speedMps: 0, bearing: 0, timeMs: 0, path });
    const immediate = poseAt(motion, 0);
    assert.ok(distanceMeters(immediate.pose, origin) < 1);
    const stepped = poseAt(immediate.motion, 50);
    const moved = distanceMeters(stepped.pose, origin);
    assert.ok(moved > 1);
    assert.ok(moved < 30);
  });

  it("keeps forecasting along the route between fixes and caps a stale lead", () => {
    const path = [origin, north(origin, 2_000)];
    const motion = noteRouteFix(null, { at: origin, speedMps: 10, bearing: 0, timeMs: 0, path });
    const atOneSecond = stepMotion(motion, 0, 1_000);
    const atLeadCap = stepMotion(atOneSecond.motion, 1_050, 1_500);
    assert.ok(distanceMeters(atLeadCap.pose, origin) > distanceMeters(atOneSecond.pose, origin));
    const stale = stepMotion(atLeadCap.motion, 1_550, 10_000);
    const lead = distanceMeters(stale.pose, origin);
    assert.ok(lead > 12 && lead < 18);
  });

  it("derives speed from successive fixes when the platform omits it", () => {
    const path = [origin, north(origin, 2_000)];
    let motion = noteRouteFix(null, { at: origin, speedMps: null, bearing: 0, timeMs: 0, path });
    motion = noteRouteFix(motion, { at: north(origin, 10), speedMps: null, bearing: 0, timeMs: 1_000, path });
    const forecast = stepMotion(motion, 1_000, 2_500);
    const fromSecondFix = distanceMeters(forecast.pose, north(origin, 10));
    assert.ok(fromSecondFix > 8);
  });

  it("follows the route around a corner instead of a straight chord", () => {
    const corner = north(origin, 100);
    const end = east(corner, 100);
    const path = [origin, corner, end];
    const start = north(origin, 90);
    const motion = noteRouteFix(null, { at: start, speedMps: 20, bearing: 0, timeMs: 0, path });
    const rounded = stepMotion(motion, 0, 2_000);
    assert.ok(rounded.pose.longitude > 10 / 111_320);
    assert.ok(Math.abs(distanceMeters(rounded.pose, corner) - 20) < 12);
    assert.ok(rounded.pose.bearing > 40);
  });

  it("holds a stopped vehicle instead of creeping or spinning on a new course", () => {
    const path = [origin, north(origin, 500)];
    let motion = noteRouteFix(null, { at: origin, speedMps: 10, bearing: 90, timeMs: 0, path });
    assert.ok(Math.abs(bearingDeltaDegrees(motion.bearing, 0)) < 1);
    motion = noteRouteFix(motion, { at: origin, speedMps: 0, bearing: 180, timeMs: 1_000, path });
    const held = stepMotion(motion, 1_000, 4_000);
    assert.ok(distanceMeters(held.pose, origin) < 2);
    assert.ok(Math.abs(bearingDeltaDegrees(held.pose.bearing, 0)) < 5);
    const creeping = noteRouteFix(null, { at: origin, speedMps: 0.4, bearing: 0, timeMs: 0, path });
    const still = stepMotion(creeping, 0, 5_000);
    assert.ok(distanceMeters(still.pose, origin) < 1);
  });

  it("turns heading across north on the short arc", () => {
    let motion = noteRouteFix(null, { at: origin, speedMps: 0, bearing: 350, timeMs: 0, path: [] });
    motion = noteRouteFix(motion, { at: origin, speedMps: 5, bearing: 10, timeMs: 0, path: [] });
    const turned = poseAt(motion, 200);
    const delta = Math.abs(bearingDeltaDegrees(350, turned.pose.bearing));
    assert.ok(delta > 0 && delta < 15);
    assert.ok(Math.abs(bearingDeltaDegrees(turned.pose.bearing, 180)) > 90);
  });

  it("smooths oscillating course so the camera bearing does not whip back and forth", () => {
    assert.equal(smoothBearing(null, 200), 200);
    const first = smoothBearing(200, 220);
    assert.ok(first > 200 && first < 220);
    // +20 then -20 raw would reverse; smoothed stays near the first correction.
    const second = smoothBearing(first, 200);
    assert.ok(Math.abs(second - first) < Math.abs(200 - first));
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

function stepMotion(motion: RouteMotion, fromMs: number, toMs: number): { motion: RouteMotion; pose: RouteMotion["displayed"] & { bearing: number } } {
  let current = motion;
  let pose = { ...current.displayed, bearing: current.displayedBearing };
  for (let time = fromMs; time <= toMs; time += 50) {
    const sampled = poseAt(current, time);
    current = sampled.motion;
    pose = sampled.pose;
  }
  return { motion: current, pose };
}

function north(from: GeoCoordinate, meters: number): GeoCoordinate {
  return { latitude: from.latitude + meters / 111_320, longitude: from.longitude };
}

function east(from: GeoCoordinate, meters: number): GeoCoordinate {
  return { latitude: from.latitude, longitude: from.longitude + meters / 111_320 };
}
