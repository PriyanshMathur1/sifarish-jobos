import { eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { users } from "../schema/index.ts";

/**
 * User repository — the only place user rows are read/written.
 * Web routes never build user queries inline (SPEC §3 choke point).
 */
export async function getUserRole(db: Db, userId: string): Promise<"user" | "admin" | null> {
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return row?.role ?? null;
}

export async function setUserRole(db: Db, userId: string, role: "user" | "admin"): Promise<void> {
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

/**
 * Account deletion (PRD §109): removes the user row; every user-owned table
 * cascades via FK. Audit the intent before calling — the row is gone after.
 */
export async function deleteUserAccount(db: Db, userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}
