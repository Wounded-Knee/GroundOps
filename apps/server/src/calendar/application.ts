import type { DrivingRoute, GeoCoordinate, User } from "@groundops/contracts";
import {
  applyAutomaticAvailability,
  applyDeferredAvailability,
  applyGuidanceAvailability,
} from "../availability/automatic.js";
import { readAvailabilityIntervals } from "../availability/availability.js";
import { authorSortie, reviseSortie } from "./authoring.js";
import { readCalendar } from "./activity.js";
import {
  commenceSortie,
  completeSortie,
  extendStopWait,
  passengerLegUnderway,
} from "./lifecycle.js";
import { recordObservation } from "./observations.js";
import { computeSortieDrivingRoute, type SortieRouteDeps } from "./sortieRoute.js";
import type { ObservationInput, ScheduleDeps, SortieInput } from "./support.js";

export async function authorWithAvailability(person: User, input: SortieInput, deps: ScheduleDeps) {
  const result = await authorSortie(person, input, deps);
  if (typeof result === "object") {
    await applyAutomaticAvailability(person, "lead", deps.now());
  }
  return result;
}

export async function reviseWithAvailability(person: User, sortieId: string, input: SortieInput, deps: ScheduleDeps) {
  const result = await reviseSortie(person, sortieId, input, deps);
  if (typeof result === "object") {
    await applyAutomaticAvailability(person, "lead", deps.now());
  }
  return result;
}

export async function extendWaitWithAvailability(
  person: User,
  sortieId: string,
  position: number,
  deps: ScheduleDeps,
) {
  const result = await extendStopWait(person, sortieId, position, deps);
  if (typeof result === "object") {
    await applyAutomaticAvailability(person, "lead", deps.now());
  }
  return result;
}

export async function commenceWithAvailability(
  person: User,
  sortieId: string,
  guidance: boolean,
  deps: ScheduleDeps,
) {
  const result = await commenceSortie(person, sortieId, deps);
  if (typeof result !== "object") {
    return result;
  }
  const fareBearing = result.stops.some((stop) => stop.passenger);
  if (guidance) {
    await applyGuidanceAvailability(person, deps.now());
  } else {
    await applyAutomaticAvailability(person, "commencement", deps.now(), fareBearing);
  }
  return result;
}

export async function completeWithAvailability(person: User, sortieId: string, deps: ScheduleDeps) {
  const result = await completeSortie(person, sortieId, deps);
  if (typeof result === "object") {
    await applyAutomaticAvailability(person, "conclusion", deps.now());
  }
  return result;
}

export async function recordWithAvailability(person: User, input: ObservationInput, deps: ScheduleDeps) {
  const result = await recordObservation(person, input, deps);
  if (result === "ok") {
    await applyDeferredAvailability(person, deps.now());
  }
  return result;
}

export async function driveSortieWithAvailability(
  person: User,
  sortieId: string,
  origin: GeoCoordinate,
  firstStopPosition: number,
  routeDeps: SortieRouteDeps,
  deps: ScheduleDeps,
): Promise<DrivingRoute | "no-driver" | "not-found" | "invalid" | "no-route" | "failed"> {
  const result = await computeSortieDrivingRoute(person, sortieId, origin, firstStopPosition, routeDeps);
  if (typeof result !== "string" && (await passengerLegUnderway(person, sortieId, firstStopPosition))) {
    await applyAutomaticAvailability(person, "commencement", deps.now(), true);
  }
  return result;
}

export async function loadCalendar(person: User, from: Date, to: Date, deps: ScheduleDeps) {
  const result = await readCalendar(person, from, to, deps);
  if (typeof result === "string") {
    return result;
  }
  const availability = await readAvailabilityIntervals(person.id, from, to);
  return { sorties: result, availability };
}
