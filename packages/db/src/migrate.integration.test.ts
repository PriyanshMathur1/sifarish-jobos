import { describe, expect, it } from "vitest";
import pg from "pg";
import { runMigrations } from "./migrate.ts";
import { seed } from "./seed.ts";

const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgres://jobos:jobos@localhost:5432/jobos_test";

async function resetDb(): Promise<void> {
  const pool = new pg.Pool({ connectionString: TEST_URL, max: 1 });
  await pool.query("drop schema if exists public cascade; create schema public;");
  await pool.query("drop schema if exists drizzle cascade;");
  await pool.end();
}

describe("migrations", () => {
  it("applies from zero, is idempotent, and supports the seed", async () => {
    await resetDb();
    await runMigrations(TEST_URL);
    await runMigrations(TEST_URL); // idempotent

    await seed(TEST_URL);

    const pool = new pg.Pool({ connectionString: TEST_URL, max: 1 });
    const { rows } = await pool.query(
      "select u.email, p.current_title from users u join profiles p on p.user_id = u.id",
    );
    await pool.end();
    expect(rows).toEqual([{ email: "dev@jobos.local", current_title: "Product Manager" }]);
  });
});
