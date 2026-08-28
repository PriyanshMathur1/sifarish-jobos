import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

/** Applies ./drizzle SQL migrations. Used by dev bootstrap, CI, and tests. */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const db = drizzle(pool);
    const dir = fileURLToPath(new URL("../drizzle", import.meta.url));
    await migrate(db, { migrationsFolder: dir });
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]?.endsWith("migrate.ts");
if (invokedDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  runMigrations(url)
    .then(() => {
      console.log("migrations applied");
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
