import type { LocationObservationRequest, ReplaceMeterReadingRequest } from "@groundops/contracts";
import { localDatabase } from "./localDatabase";

const observationCap = 200;

export type QueuedObservation = LocationObservationRequest & { id: string };

export async function enqueueObservation(userId: string, observation: QueuedObservation): Promise<void> {
  const db = await localDatabase();
  const countRows = await db.getAllAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM location_outbox WHERE user_id = ?",
    userId,
  );
  const count = countRows[0]?.count ?? 0;
  if (count >= observationCap) {
    await db.runAsync(
      "DELETE FROM location_outbox WHERE user_id = ? AND id = (SELECT id FROM location_outbox WHERE user_id = ? ORDER BY observed_at LIMIT 1)",
      userId,
      userId,
    );
  }
  await db.runAsync(
    "INSERT INTO location_outbox (user_id, id, observed_at, payload_json) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET observed_at = excluded.observed_at, payload_json = excluded.payload_json",
    userId,
    observation.id,
    observation.observedAt,
    JSON.stringify(observation),
  );
}

export async function readObservations(userId: string): Promise<QueuedObservation[]> {
  const db = await localDatabase();
  const rows = await db.getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM location_outbox WHERE user_id = ? ORDER BY observed_at",
    userId,
  );
  const observations: QueuedObservation[] = [];
  for (const row of rows) {
    try {
      const parsed: unknown = JSON.parse(row.payload_json);
      if (isObservation(parsed)) {
        observations.push(parsed);
      }
    } catch {
      // A damaged row is skipped. The next flush leaves it until it is deleted by hand.
    }
  }
  return observations;
}

export async function removeObservation(userId: string, id: string): Promise<void> {
  const db = await localDatabase();
  await db.runAsync("DELETE FROM location_outbox WHERE user_id = ? AND id = ?", userId, id);
}

export async function writeMeterOutbox(userId: string, report: ReplaceMeterReadingRequest): Promise<void> {
  const db = await localDatabase();
  await db.runAsync(
    "INSERT INTO meter_outbox (user_id, payload_json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET payload_json = excluded.payload_json",
    userId,
    JSON.stringify(report),
  );
}

export async function readMeterOutbox(userId: string): Promise<ReplaceMeterReadingRequest | null> {
  const db = await localDatabase();
  const rows = await db.getAllAsync<{ payload_json: string }>("SELECT payload_json FROM meter_outbox WHERE user_id = ?", userId);
  const payload = rows[0]?.payload_json;
  if (!payload) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    return isMeter(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearMeterOutbox(userId: string): Promise<void> {
  const db = await localDatabase();
  await db.runAsync("DELETE FROM meter_outbox WHERE user_id = ?", userId);
}

function isObservation(value: unknown): value is QueuedObservation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.observedAt === "string" &&
    typeof record.latitude === "number" &&
    typeof record.longitude === "number"
  );
}

function isMeter(value: unknown): value is ReplaceMeterReadingRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.sortieId === "string" && typeof record.milesTraveled === "number";
}
