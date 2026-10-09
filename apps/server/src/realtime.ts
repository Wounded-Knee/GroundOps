import { AsyncLocalStorage } from "node:async_hooks";
import type { LocationFix, MeterReading, RealtimeEnvelope, Sortie } from "@groundops/contracts";

export type RealtimePublisher = (envelope: RealtimeEnvelope) => Promise<void> | void;

const localPublisher = new AsyncLocalStorage<RealtimePublisher>();
let processPublisher: RealtimePublisher | null = null;
let logFailure: (error: unknown) => void = (error) => {
  console.error(JSON.stringify({ msg: "realtime publish failed", err: error instanceof Error ? error.message : String(error) }));
};

export function setRealtimePublisher(publisher: RealtimePublisher | null, log?: (error: unknown) => void): void {
  processPublisher = publisher;
  if (log) {
    logFailure = log;
  }
}

/** Scopes a publisher to one async call so tests do not share the process publisher. */
export function withRealtimePublisher<T>(publisher: RealtimePublisher, run: () => Promise<T>): Promise<T> {
  return localPublisher.run(publisher, run);
}

export async function publishRealtime(envelope: RealtimeEnvelope): Promise<void> {
  const publisher = localPublisher.getStore() ?? processPublisher;
  if (!publisher) {
    return;
  }
  try {
    await publisher(envelope);
  } catch (error) {
    logFailure(error);
  }
}

export function sortieUpdated(userId: string, sortie: Sortie, recordedAt = new Date().toISOString()): RealtimeEnvelope {
  return { id: crypto.randomUUID(), type: "sortie.updated", userId, recordedAt, sortie };
}

export function locationUpdated(userId: string, location: LocationFix, recordedAt = new Date().toISOString()): RealtimeEnvelope {
  return { id: crypto.randomUUID(), type: "location.updated", userId, recordedAt, location };
}

export function meterUpdated(userId: string, meter: MeterReading, recordedAt = new Date().toISOString()): RealtimeEnvelope {
  return { id: crypto.randomUUID(), type: "meter.updated", userId, recordedAt, meter };
}

export function meterCleared(userId: string, recordedAt = new Date().toISOString()): RealtimeEnvelope {
  return { id: crypto.randomUUID(), type: "meter.cleared", userId, recordedAt };
}
