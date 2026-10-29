import { localDatabase } from "./localDatabase";

export type GuidanceSnapshotPayload = {
  nav: unknown;
  meter: unknown;
  completedLegPaths: unknown;
};

export async function writeGuidanceSnapshot(userId: string, payload: GuidanceSnapshotPayload): Promise<void> {
  const db = await localDatabase();
  await db.runAsync(
    "INSERT INTO guidance_snapshot (user_id, payload_json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET payload_json = excluded.payload_json",
    userId,
    JSON.stringify(payload),
  );
}

export async function readGuidanceSnapshot(userId: string): Promise<GuidanceSnapshotPayload | null> {
  const db = await localDatabase();
  const rows = await db.getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM guidance_snapshot WHERE user_id = ?",
    userId,
  );
  const payload = rows[0]?.payload_json;
  if (!payload) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== "object" || parsed === null || !("nav" in parsed) || !("meter" in parsed)) {
      return null;
    }
    const record = parsed as { nav: unknown; meter: unknown; completedLegPaths?: unknown };
    const nav = record.nav;
    if (typeof nav !== "object" || nav === null || !("mode" in nav)) {
      return null;
    }
    const mode = (nav as { mode: unknown }).mode;
    if (mode !== "guiding" && mode !== "arrived") {
      return null;
    }
    return { nav, meter: record.meter, completedLegPaths: record.completedLegPaths ?? [] };
  } catch {
    return null;
  }
}

export async function clearGuidanceSnapshot(userId: string): Promise<void> {
  const db = await localDatabase();
  await db.runAsync("DELETE FROM guidance_snapshot WHERE user_id = ?", userId);
}
