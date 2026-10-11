import type { AvailabilityResponse, RealtimeEnvelope } from "@groundops/contracts";

/** How often a signed-in client refreshes a willing driver's check-in. */
export const availabilityCheckInMs = 3 * 60 * 1000;

export type AvailabilityView = AvailabilityResponse;

export const emptyAvailability: AvailabilityView = {
  asOf: "",
  available: false,
  current: false,
};

export type AvailabilityEnvelope = Extract<RealtimeEnvelope, { type: "availability.updated" }>;

/** Bright when the platform treats the driver as available. An older envelope is ignored. */
export function applyAvailabilityEnvelope(state: AvailabilityView, envelope: AvailabilityEnvelope): AvailabilityView {
  if (envelope.recordedAt <= state.asOf) {
    return state;
  }
  return {
    asOf: envelope.recordedAt,
    available: envelope.available,
    current: envelope.current,
  };
}

/** A read replaces the bar unless a newer envelope already arrived. */
export function applyAvailabilitySnapshot(state: AvailabilityView, snapshot: AvailabilityResponse): AvailabilityView {
  if (snapshot.asOf < state.asOf) {
    return state;
  }
  return snapshot;
}

const listeners = new Set<(envelope: AvailabilityEnvelope) => void>();

export function deliverAvailabilityEnvelope(envelope: AvailabilityEnvelope): void {
  for (const listener of listeners) {
    listener(envelope);
  }
}

export function subscribeAvailability(listener: (envelope: AvailabilityEnvelope) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
