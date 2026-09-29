import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import {
  locationObservationTaskName,
  reportEligibleLocationFix,
} from "./locationObservationReporting";

TaskManager.defineTask(locationObservationTaskName, async ({ data, error }) => {
  if (error) {
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (!locations || locations.length === 0) {
    return;
  }
  for (const location of locations) {
    await reportEligibleLocationFix(location);
  }
});
