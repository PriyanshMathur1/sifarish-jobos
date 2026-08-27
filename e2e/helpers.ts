import type { BrowserContext } from "@playwright/test";
import pg from "pg";
import { randomBytes } from "node:crypto";

const DB_URL = process.env.DATABASE_URL ?? "postgres://jobos:jobos@localhost:5432/jobos";

/**
 * E2E sign-in: create a real user + session row and set the session cookie —
 * the exact artifact a completed magic-link flow produces (Auth.js database
 * sessions), without needing to intercept email.
 */
export async function signInAs(
  context: BrowserContext,
  email: string,
  opts: { admin?: boolean } = {},
): Promise<{ userId: string }> {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 1 });
  try {
    const role = opts.admin ? "admin" : "user";
    const { rows } = await pool.query(
      `insert into users (id, email, role) values (gen_random_uuid(), $1, $2)
       on conflict (email) do update set role = excluded.role
       returning id`,
      [email, role],
    );
    const userId: string = rows[0].id;
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 3600 * 1000);
    await pool.query(`insert into sessions (session_token, user_id, expires) values ($1, $2, $3)`, [
      token,
      userId,
      expires,
    ]);
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: token,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    return { userId };
  } finally {
    await pool.end();
  }
}

export async function deleteUser(email: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 1 });
  try {
    await pool.query(`delete from users where email = $1`, [email]);
  } finally {
    await pool.end();
  }
}
