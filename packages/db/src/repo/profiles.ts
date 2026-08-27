import { eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { profiles } from "../schema/index.ts";

export interface ProfileInput {
  fullName: string | null;
  currentTitle: string | null;
  yearsExperience: number | null;
  skills: string[];
  locations: string[];
}

/** Owner-scoped: a profile is only ever read/written for the given userId. */
export async function getProfile(db: Db, userId: string) {
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  return row ?? null;
}

export async function upsertProfile(db: Db, userId: string, input: ProfileInput): Promise<void> {
  await db
    .insert(profiles)
    .values({ userId, ...input, summarySource: "manual" })
    .onConflictDoUpdate({ target: profiles.userId, set: { ...input } });
}
