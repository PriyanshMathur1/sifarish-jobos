import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@sifarish/db/schema/index";
import { runMigrations } from "@sifarish/db/migrate";
import * as matchesRepo from "@sifarish/db/repo/matches";
import { recomputeForCompany, recomputeForUser } from "./recompute.ts";

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://sifarish:sifarish@localhost:5432/sifarish_test";

let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;
let companyId: string;
let pmJobId: string;
let engJobId: string;

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: TEST_URL, max: 1 });
  await admin.query("drop schema if exists public cascade; create schema public;");
  await admin.query("drop schema if exists drizzle cascade; drop schema if exists pgboss cascade;");
  await admin.end();
  await runMigrations(TEST_URL);
  db = drizzle(new pg.Pool({ connectionString: TEST_URL, max: 4 }), { schema });

  const [user] = await db.insert(schema.users).values({ email: "match@sifarish.local" }).returning();
  userId = user!.id;
  await db.insert(schema.profiles).values({
    userId,
    currentTitle: "Product Manager",
    yearsExperience: 5,
    skills: ["SQL", "Experimentation", "Amplitude"],
    locations: ["Bengaluru"],
  });
  await db.insert(schema.candidatePreferences).values({
    userId,
    targetRoles: ["Product Manager"],
    targetFunctions: ["Product"],
    excludedCompanies: ["Evil Corp"],
  });

  const [company] = await db
    .insert(schema.companies)
    .values({ name: "Razorpay", normalizedName: "razorpay", domain: "razorpay.com", industry: "Fintech" })
    .returning();
  companyId = company!.id;

  const base = {
    companyId,
    sourceProvider: "seed",
    marketEligibility: "IN_CONFIRMED" as const,
    contentHash: "x",
    locations: ["Bengaluru"],
    remoteType: "hybrid" as const,
  };
  const [pm] = await db
    .insert(schema.jobs)
    .values({
      ...base,
      externalId: "pm",
      title: "Senior Product Manager",
      normalizedTitle: "Product Manager",
      titleFunction: "Product",
      seniority: "senior",
      descriptionText: "SQL, a/b testing and Amplitude every day.",
    })
    .returning();
  pmJobId = pm!.id;
  const [eng] = await db
    .insert(schema.jobs)
    .values({
      ...base,
      externalId: "eng",
      title: "Senior Software Engineer",
      normalizedTitle: "Software Engineer",
      titleFunction: "Engineering",
      seniority: "senior",
      descriptionText: "TypeScript and Kubernetes.",
    })
    .returning();
  engJobId = eng!.id;
  await db.insert(schema.jobs).values({
    ...base,
    externalId: "gone",
    title: "Product Manager",
    normalizedTitle: "Product Manager",
    titleFunction: "Product",
    seniority: "manager",
    status: "REMOVED",
  });
});

describe("recompute", () => {
  it("scores every live job of a company for every profiled user", async () => {
    const n = await recomputeForCompany(db, companyId);
    expect(n).toBe(2); // REMOVED job is not scored

    const pm = await matchesRepo.matchForJob(db, userId, pmJobId);
    const eng = await matchesRepo.matchForJob(db, userId, engJobId);
    expect(pm?.band).toBe("strong");
    expect(eng?.score).toBeLessThan(pm!.score);
    expect(pm?.reasons.some((r) => r.includes("SQL"))).toBe(true);
  });

  it("is idempotent and picks up profile changes on the user path", async () => {
    await recomputeForUser(db, userId);
    const before = await matchesRepo.matchForJob(db, userId, pmJobId);

    await db
      .update(schema.candidatePreferences)
      .set({ excludedCompanies: ["Razorpay"] })
      .where(eq(schema.candidatePreferences.userId, userId));
    await recomputeForUser(db, userId);
    const after = await matchesRepo.matchForJob(db, userId, pmJobId);
    expect(before?.gate).toBeNull();
    expect(after?.gate).toMatch(/excluded/i);
    expect(after?.score).toBe(0);

    await db
      .update(schema.candidatePreferences)
      .set({ excludedCompanies: [] })
      .where(eq(schema.candidatePreferences.userId, userId));
    await recomputeForUser(db, userId);
  });

  it("feeds best-first, hides gated and hidden jobs", async () => {
    const feed = await matchesRepo.feedForUser(db, userId, {});
    expect(feed.map((f) => f.id)).toEqual([pmJobId, engJobId]);
    expect(feed[0]!.band).toBe("strong");

    const strongOnly = await matchesRepo.feedForUser(db, userId, { minBand: "strong" });
    expect(strongOnly.map((f) => f.id)).toEqual([pmJobId]);

    await db.insert(schema.userJobEvents).values({ userId, jobId: engJobId, type: "HIDE" });
    const afterHide = await matchesRepo.feedForUser(db, userId, {});
    expect(afterHide.map((f) => f.id)).toEqual([pmJobId]);

    const counts = await matchesRepo.bandCounts(db, userId, 7);
    expect(counts.strong).toBe(1);
  });
});
