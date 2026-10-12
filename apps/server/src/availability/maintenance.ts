import { availabilityLapseIntervalMs, recordAvailabilityLapse } from "./availability.js";
import { applyAutomaticAvailabilityLead } from "./automatic.js";

/** Starts the in-process lapse sweep and the automatic availability rule. Importing this module does not start it. */
export function startAvailabilityMaintenance(onError: (error: unknown) => void): () => void {
  const timer = setInterval(() => {
    const now = new Date();
    void recordAvailabilityLapse(now).catch(onError);
    void applyAutomaticAvailabilityLead(now).catch(onError);
  }, availabilityLapseIntervalMs);
  return () => {
    clearInterval(timer);
  };
}
