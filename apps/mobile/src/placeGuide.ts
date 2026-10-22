import type { DrivingRoute, PlaceSuggestion } from "@groundops/contracts";

/** Turn-by-turn to a place that is not a sortie. */
export type PlaceGuideCommand = {
  destination: PlaceSuggestion;
  route: DrivingRoute;
};
