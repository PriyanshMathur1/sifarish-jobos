import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getDb, closeDb } from "./client.ts";
import * as schema from "./schema/index.ts";
import { users, profiles, candidatePreferences, companies, jobs } from "./schema/index.ts";
import { COMPANY_SEEDS, JOB_SEEDS } from "./seed-data.ts";
import { createHash } from "node:crypto";

/**
 * Development seed (PRD §129): a dev user with a realistic profile so the
 * product is visible immediately. Phase 1 adds companies + fixture jobs.
 * Idempotent — safe to re-run.
 */
export async function seed(connectionString?: string): Promise<void> {
  // With an explicit URL (tests), own the pool and close it on exit.
  const ownPool = connectionString ? new pg.Pool({ connectionString, max: 2 }) : null;
  const db = ownPool ? drizzle(ownPool, { schema }) : getDb();
  try {
    await seedInto(db);
  } finally {
    await ownPool?.end();
  }
}

type SeedDb = ReturnType<typeof getDb>;

async function seedInto(db: SeedDb): Promise<void> {
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

  // Company registry (ticket 1.11) — idempotent on (ats_provider, ats_identifier).
  const companyIdByName = new Map<string, string>();
  for (const c of COMPANY_SEEDS) {
    const [row] = await db
      .insert(companies)
      .values({
        name: c.name,
        normalizedName: c.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim(),
        domain: c.domain,
        industry: c.industry,
        atsProvider: c.atsProvider,
        atsIdentifier: c.atsIdentifier,
        careersUrl: c.careersUrl ?? null,
        detectionConfidence: "high",
      })
      .onConflictDoUpdate({
        target: [companies.atsProvider, companies.atsIdentifier],
        set: { name: c.name, domain: c.domain, industry: c.industry },
      })
      .returning({ id: companies.id, name: companies.name });
    if (row) companyIdByName.set(row.name, row.id);
  }

  // Offline dev jobs (PRD §129) — clearly marked; a live refresh supersedes.
  for (const j of JOB_SEEDS) {
    const companyId = companyIdByName.get(j.companyName);
    if (!companyId) continue;
    const descriptionText = j.descriptionHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    await db
      .insert(jobs)
      .values({
        companyId,
        externalId: j.externalId,
        sourceProvider: "seed",
        title: j.title,
        normalizedTitle: j.title,
        seniority: "mid",
        descriptionHtml: j.descriptionHtml,
        descriptionText,
        locations: j.locations,
        remoteType: j.remoteType,
        marketEligibility: j.marketEligibility,
        employmentType: j.employmentType,
        applyUrl: j.applyUrl,
        sourceUrl: j.applyUrl,
        sourcePostedAt: j.sourcePostedAt ? new Date(j.sourcePostedAt) : null,
        contentHash: createHash("sha256")
          .update(j.externalId + j.title)
          .digest("hex"),
      })
      .onConflictDoNothing();
  }
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
