import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export type Db = NodePgDatabase<typeof schema>;

let cached: { db: Db; pool: pg.Pool } | null = null;

/** One pool per process. Pass a URL explicitly in tests. */
export function getDb(connectionString?: string): Db {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (cached) return cached.db;
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  if (!connectionString) cached = { db, pool };
  return db;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.pool.end();
    cached = null;
  }
}

export { schema };
