import { getDb, closeDb } from "./client.ts";
import { users, profiles, candidatePreferences } from "./schema/index.ts";

/**
 * Development seed (PRD §129): a dev user with a realistic profile so the
 * product is visible immediately. Phase 1 adds companies + fixture jobs.
 * Idempotent — safe to re-run.
 */
export async function seed(connectionString?: string): Promise<void> {
  const db = getDb(connectionString);

  const [dev] = await db
    .insert(users)
    .values({ email: "dev@jobos.local", name: "Dev User", role: "admin" })
    .onConflictDoUpdate({ target: users.email, set: { name: "Dev User", role: "admin" } })
    .returning();
  if (!dev) throw new Error("seed: failed to upsert dev user");

  await db
    .insert(profiles)
    .values({
      userId: dev.id,
      fullName: "Dev User",
      currentTitle: "Product Manager",
      yearsExperience: 5,
      skills: ["Product Management", "Growth", "SEO", "Experimentation", "SQL"],
      functions: ["Product"],
      industries: ["Fintech"],
      locations: ["Bengaluru"],
      summarySource: "manual",
    })
    .onConflictDoNothing({ target: profiles.userId });

  await db
    .insert(candidatePreferences)
    .values({
      userId: dev.id,
      targetRoles: ["Product Manager", "Senior Product Manager", "Growth Product Manager"],
      targetFunctions: ["Product"],
      locations: ["Bengaluru", "Remote"],
      remotePref: "any",
      industriesPreferred: ["Fintech"],
      strictness: { locations: "preferred", industriesPreferred: "preferred" },
    })
    .onConflictDoNothing({ target: candidatePreferences.userId });
}

const invokedDirectly = process.argv[1]?.endsWith("seed.ts");
if (invokedDirectly) {
  seed()
    .then(async () => {
      console.log("seeded");
      await closeDb();
    })
    .catch(async (e) => {
      console.error(e);
      await closeDb();
      process.exit(1);
    });
}
