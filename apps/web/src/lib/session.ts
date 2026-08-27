import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb, usersRepo } from "@jobos/db";

/** The one auth guard — pages/actions never re-implement session checks. */
export async function requireUser(): Promise<{ userId: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  return { userId: session.user.id };
}

export async function requireAdmin(): Promise<{ userId: string }> {
  const { userId } = await requireUser();
  const role = await usersRepo.getUserRole(getDb(), userId);
  if (role !== "admin") redirect("/jobs");
  return { userId };
}

export async function isAdmin(userId: string): Promise<boolean> {
  return (await usersRepo.getUserRole(getDb(), userId)) === "admin";
}
