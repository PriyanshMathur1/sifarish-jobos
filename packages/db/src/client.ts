import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export type Db = NodePgDatabase<typeof schema>;

let cached: { db: Db; pool: pg.Pool } | null = null;

/**
 * One memoized pool per process for the default DATABASE_URL.
 * An explicit `connectionString` ALWAYS gets its own connection (tests) —
 * it is never served from, and never populates, the cache.
 */
export function getDb(connectionString?: string): Db {
  if (connectionString) {
    const pool = new pg.Pool({ connectionString, max: 5 });
    return drizzle(pool, { schema });
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (cached) return cached.db;
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  cached = { db, pool };
  return db;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.pool.end();
    cached = null;
  }
}

export { schema };
