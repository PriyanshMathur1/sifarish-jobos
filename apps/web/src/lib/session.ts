import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb, usersRepo } from "@sifarish/db";
import { loadConfig } from "@sifarish/core";

/** The one auth guard — pages/actions never re-implement session checks. */
export async function requireUser(): Promise<{ userId: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  return { userId: session.user.id };
}

/**
 * Admin = role column, or an email listed in ADMIN_EMAILS (comma-separated).
 * The env route exists so the first admin can be granted from Vercel settings
 * without touching the database; the role column is promoted on first sight.
 */
async function adminByEnv(userId: string): Promise<boolean> {
  const list = (loadConfig().ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !list.includes(email)) return false;
  await usersRepo.setUserRole(getDb(), userId, "admin");
  return true;
}

export async function isAdmin(userId: string): Promise<boolean> {
  if ((await usersRepo.getUserRole(getDb(), userId)) === "admin") return true;
  return adminByEnv(userId);
}

export async function requireAdmin(): Promise<{ userId: string }> {
  const { userId } = await requireUser();
  if (!(await isAdmin(userId))) redirect("/jobs");
  return { userId };
}
