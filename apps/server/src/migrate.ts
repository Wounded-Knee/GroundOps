import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db.js";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../drizzle");

export async function migrateDatabase(): Promise<void> {
  await migrate(db, { migrationsFolder });
}
