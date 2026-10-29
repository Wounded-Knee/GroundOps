import type { GeoCoordinate } from "@groundops/contracts";
import { arrivalMeters, distanceMeters } from "./guidance";
import {
  noteArrivalDwell,
  shouldCompleteOnLeave,
  type ArrivalDwellState,
} from "./sortieDwell";
import { stationaryDisplacementMeters } from "./meter";

export type ArrivedFixChoice = "start-next-leg" | "end-guidance" | "stay";

export function arrivedFixChoice(input: {
  distanceToStopMeters: number | null;
  resumeTravelMeters: number;
  hasLaterStop: boolean;
  pendingNextLeg: boolean;
  isFinal: boolean;
  stationaryDwellMet: boolean;
}): ArrivedFixChoice {
  const hasStop = input.distanceToStopMeters !== null;
  const resumedByGps =
    input.resumeTravelMeters > 0 &&
    hasStop &&
    input.distanceToStopMeters !== null &&
    input.distanceToStopMeters > input.resumeTravelMeters;
  if (hasStop && (input.hasLaterStop || input.pendingNextLeg) && resumedByGps) {
    return "start-next-leg";
  }
  const outsideGeofence = hasStop && input.distanceToStopMeters !== null && input.distanceToStopMeters > arrivalMeters;
  if (
    shouldCompleteOnLeave({
      isFinal: input.isFinal,
      hasLaterStop: input.hasLaterStop,
      pendingNextLeg: input.pendingNextLeg,
      outsideGeofence,
      stationaryDwellMet: input.stationaryDwellMet,
    })
  ) {
    return "end-guidance";
  }
  return "stay";
}

export type GuidingSortieFixChoice = {
  dwell: ArrivalDwellState;
  action: "enter-stop" | "hold" | "fall-through";
};

/** Final-stop dwell, or an immediate enter on an earlier stop. `fall-through` continues into route motion. */
export function guidingSortieFixChoice(input: {
  inside: boolean;
  finalLeg: boolean;
  dwell: ArrivalDwellState;
  fix: GeoCoordinate;
  nowMs: number;
}): GuidingSortieFixChoice {
  if (input.finalLeg) {
    const dwell = noteArrivalDwell(input.dwell, {
      inside: input.inside,
      fix: input.fix,
      nowMs: input.nowMs,
      stationaryMeters: stationaryDisplacementMeters,
    });
    if (dwell.satisfied) {
      return { dwell, action: "enter-stop" };
    }
    if (input.inside) {
      return { dwell, action: "hold" };
    }
    return { dwell, action: "fall-through" };
  }
  if (input.inside) {
    return { dwell: input.dwell, action: "enter-stop" };
  }
  return { dwell: input.dwell, action: "fall-through" };
}

export function insideArrival(distanceToTargetMeters: number | null): boolean {
  return distanceToTargetMeters !== null && distanceToTargetMeters <= arrivalMeters;
}
