import type { Sortie, SortieStop } from "@groundops/contracts";
import { taskSortieType } from "@groundops/contracts";
import * as SQLite from "expo-sqlite";

export type CachedCalendar = {
  userId: string;
  from: string;
  to: string;
  sorties: Sortie[];
};

let opening: Promise<SQLite.SQLiteDatabase> | null = null;

export async function readCalendarCache(userId: string): Promise<CachedCalendar | null> {
  const db = await database();
  const rows = await db.getAllAsync<{
    user_id: string;
    range_from: string;
    range_to: string;
    sorties_json: string;
  }>("SELECT user_id, range_from, range_to, sorties_json FROM calendar_cache WHERE id = 1");
  const row = rows[0];
  if (!row) {
    return null;
  }
  if (row.user_id !== userId) {
    await clearCalendarCache();
    return null;
  }
  const sorties = parseSorties(row.sorties_json);
  if (!sorties) {
    await clearCalendarCache();
    return null;
  }
  return { userId, from: row.range_from, to: row.range_to, sorties };
}

export async function writeCalendarCache(cache: CachedCalendar): Promise<void> {
  const db = await database();
  await db.execAsync("DELETE FROM calendar_cache");
  await db.runAsync(
    "INSERT INTO calendar_cache (id, user_id, range_from, range_to, sorties_json) VALUES (1, ?, ?, ?, ?)",
    cache.userId,
    cache.from,
    cache.to,
    JSON.stringify(cache.sorties),
  );
}

export async function clearCalendarCache(): Promise<void> {
  const db = await database();
  await db.execAsync("DELETE FROM calendar_cache");
}

function database(): Promise<SQLite.SQLiteDatabase> {
  opening ??= openDatabase();
  return opening;
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync("groundops-calendar");
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS calendar_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id TEXT NOT NULL,
      range_from TEXT NOT NULL,
      range_to TEXT NOT NULL,
      sorties_json TEXT NOT NULL
    );
  `);
  return db;
}

function parseSorties(value: string): Sortie[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const sorties: Sortie[] = [];
  for (const item of parsed) {
    if (!isSortie(item)) {
      return null;
    }
    sorties.push(item);
  }
  return sorties;
}

function isSortie(value: unknown): value is Sortie {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.type === taskSortieType &&
    typeof record.label === "string" &&
    typeof record.arrivalAt === "string" &&
    typeof record.arrivalAuthored === "boolean" &&
    typeof record.scheduledStart === "string" &&
    typeof record.scheduledEnd === "string" &&
    (record.actualStart === null || typeof record.actualStart === "string") &&
    (record.actualEnd === null || typeof record.actualEnd === "string") &&
    typeof record.departureAddress === "string" &&
    (record.passengerName === null || typeof record.passengerName === "string") &&
    (record.passengerPhone === null || typeof record.passengerPhone === "string") &&
    Array.isArray(record.stops) &&
    record.stops.every(isStop)
  );
}

function isStop(value: unknown): value is SortieStop {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.label === "string" &&
    record.label.length > 0 &&
    typeof record.latitude === "number" &&
    Number.isFinite(record.latitude) &&
    typeof record.longitude === "number" &&
    Number.isFinite(record.longitude) &&
    Number.isInteger(record.waitMinutes) &&
    Number(record.waitMinutes) >= 0 &&
    typeof record.passenger === "boolean" &&
    (record.actualArrivedAt === null || typeof record.actualArrivedAt === "string") &&
    (record.actualDepartedAt === null || typeof record.actualDepartedAt === "string")
  );
}
