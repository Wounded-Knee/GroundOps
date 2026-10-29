import * as SQLite from "expo-sqlite";

let opening: Promise<SQLite.SQLiteDatabase> | null = null;

export function localDatabase(): Promise<SQLite.SQLiteDatabase> {
  opening ??= openDatabase();
  return opening;
}

export async function clearOfflineStore(): Promise<void> {
  const db = await localDatabase();
  await db.execAsync(`
    DELETE FROM calendar_cache;
    DELETE FROM read_cache;
    DELETE FROM pending_sortie;
    DELETE FROM location_outbox;
    DELETE FROM meter_outbox;
    DELETE FROM guidance_snapshot;
  `);
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync("groundops-calendar");
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS calendar_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id TEXT NOT NULL,
      range_from TEXT NOT NULL,
      range_to TEXT NOT NULL,
      sorties_json TEXT NOT NULL,
      availability_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS read_cache (
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (user_id, kind)
    );
    CREATE TABLE IF NOT EXISTS pending_sortie (
      user_id TEXT NOT NULL,
      sortie_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      body_json TEXT NOT NULL,
      provisional_json TEXT NOT NULL,
      pre_image_json TEXT,
      authored_at TEXT NOT NULL,
      PRIMARY KEY (user_id, sortie_id)
    );
    CREATE TABLE IF NOT EXISTS location_outbox (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE TABLE IF NOT EXISTS meter_outbox (
      user_id TEXT NOT NULL PRIMARY KEY,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS guidance_snapshot (
      user_id TEXT NOT NULL PRIMARY KEY,
      payload_json TEXT NOT NULL
    );
  `);
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(calendar_cache)");
  if (!columns.some((column) => column.name === "availability_json")) {
    await db.execAsync("ALTER TABLE calendar_cache ADD COLUMN availability_json TEXT NOT NULL DEFAULT '[]'");
  }
  return db;
}
