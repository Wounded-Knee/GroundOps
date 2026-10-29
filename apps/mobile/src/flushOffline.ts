import { authorSortie, ensureCurrentDriver, replaceMeterReading, reportLocationObservation, reviseSortie } from "./calendarClient";
import { clearMeterOutbox, readMeterOutbox, readObservations, removeObservation } from "./locationOutbox";
import { readPending, removePending } from "./pendingSorties";

export type FlushResult = "idle" | "synced" | "retry" | "rejected" | "unauthorized";

export async function flushOffline(apiUrl: string, token: string, userId: string): Promise<FlushResult> {
  const observations = await readObservations(userId);
  const pending = await readPending(userId);
  const meter = await readMeterOutbox(userId);
  if (observations.length === 0 && pending.length === 0 && meter === null) {
    return "idle";
  }

  if (observations.length > 0 || pending.length > 0) {
    const driver = await ensureCurrentDriver(apiUrl, token);
    if (driver === "unauthorized") {
      return "unauthorized";
    }
    if (driver === "unreachable") {
      return "retry";
    }
  }

  let synced = false;
  let rejected = false;
  for (const observation of observations) {
    const result = await reportLocationObservation(apiUrl, token, observation);
    if (result === "unauthorized") {
      return "unauthorized";
    }
    if (result === "unreachable") {
      return synced ? "synced" : "retry";
    }
    await removeObservation(userId, observation.id);
    if (result === "ok") {
      synced = true;
    }
  }

  const creates = pending.filter((command) => command.kind === "create");
  const revises = pending.filter((command) => command.kind === "revise");
  for (const command of [...creates, ...revises]) {
    const saved =
      command.kind === "create"
        ? await authorSortie(apiUrl, token, { ...command.body, id: command.sortieId })
        : await reviseSortie(apiUrl, token, command.sortieId, command.body);
    if (saved === "unauthorized") {
      return "unauthorized";
    }
    if (saved === "unreachable" || saved === "unavailable") {
      if (rejected) {
        return "rejected";
      }
      return synced ? "synced" : "retry";
    }
    await removePending(userId, command.sortieId);
    if (typeof saved === "string") {
      rejected = true;
    } else {
      synced = true;
    }
  }

  if (meter) {
    const reported = await replaceMeterReading(apiUrl, token, meter);
    if (reported === "unauthorized") {
      return "unauthorized";
    }
    if (reported === "unreachable") {
      if (rejected) {
        return "rejected";
      }
      return synced ? "synced" : "retry";
    }
    await clearMeterOutbox(userId);
    if (typeof reported === "object") {
      synced = true;
    }
  }

  if (rejected) {
    return "rejected";
  }
  return synced ? "synced" : "idle";
}
