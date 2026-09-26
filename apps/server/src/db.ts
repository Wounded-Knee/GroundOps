import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const client = openDatabase(databaseUrl);

export const db = drizzle(client, { schema });

export async function pingDatabase(): Promise<void> {
  await db.execute(sql`select 1`);
}

export async function closeDatabase(): Promise<void> {
  await client.end({ timeout: 5 });
}

function openDatabase(databaseUrl: string): postgres.Sql {
  const url = new URL(databaseUrl);
  const socketHost = url.searchParams.get("host");
  if (!socketHost?.startsWith("/")) {
    return postgres(databaseUrl);
  }

  const database = url.pathname.replace(/^\//, "");
  if (!database) {
    throw new Error("DATABASE_URL is missing a database name");
  }

  return postgres({
    host: socketHost,
    database,
    port: url.port ? Number(url.port) : 5432,
    ...(url.username ? { user: decodeURIComponent(url.username) } : {}),
  });
}
