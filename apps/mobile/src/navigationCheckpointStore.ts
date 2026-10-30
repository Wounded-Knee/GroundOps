import { localDatabase } from "./localDatabase";
import { parseNavigationCheckpoint, type NavigationCheckpoint } from "./navigationCheckpoint";

/** Read this user's sortie guidance checkpoint. A missing, mismatched, or corrupt row is absent. */
export async function readNavigationCheckpoint(userId: string): Promise<NavigationCheckpoint | null> {
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
    const checkpoint = parseNavigationCheckpoint(JSON.parse(payload) as unknown, userId);
    if (!checkpoint) {
      await clearNavigationCheckpoint(userId);
    }
    return checkpoint;
  } catch {
    await clearNavigationCheckpoint(userId);
    return null;
  }
}

export async function writeNavigationCheckpoint(checkpoint: NavigationCheckpoint): Promise<void> {
  const db = await localDatabase();
  await db.runAsync(
    "INSERT INTO guidance_snapshot (user_id, payload_json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET payload_json = excluded.payload_json",
    checkpoint.userId,
    JSON.stringify(checkpoint),
  );
}

/** Delete one user's checkpoint, or every checkpoint when no user is given. */
export async function clearNavigationCheckpoint(userId?: string): Promise<void> {
  const db = await localDatabase();
  if (userId === undefined) {
    await db.execAsync("DELETE FROM guidance_snapshot");
    return;
  }
  await db.runAsync("DELETE FROM guidance_snapshot WHERE user_id = ?", userId);
}
