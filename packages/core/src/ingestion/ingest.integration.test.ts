import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@jobos/db/schema/index";
import { runMigrations } from "@jobos/db/migrate";
import { SafeFetcher } from "../fetch/safe-fetcher.ts";
import { refreshCompany } from "./ingest.ts";

/**
 * Ingestion state machine (SPEC §2 Ingestion, PRD §26–31) driven end-to-end
 * against a real Postgres and fixture payloads. The seam under test is
 * refreshCompany(deps, companyId, runId) — nothing else.
 */
const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://jobos:jobos@localhost:5432/jobos_test";

const ghListing = (
  jobs: Array<{ id: number; title: string; location: string; content?: string }>,
) =>
  JSON.stringify({
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      location: { name: j.location },
      content: j.content ?? "&lt;p&gt;Job description&lt;/p&gt;",
      absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${j.id}`,
      first_published: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-20T00:00:00Z",
    })),
  });

/** Fetcher whose next response is programmable per test step. */
function stubFetcher(state: { body: string; status: number }) {
  return new SafeFetcher({
    resolve: async () => ["93.184.216.34"],
    fetchImpl: async () => new Response(state.body, { status: state.status }),
    sleep: async () => {},
    maxRetries: 0,
  });
}

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let companyId: string;
const state = { body: "", status: 200 };
const deps = () => ({ db: db as never, fetcher: stubFetcher(state), marketCountries: ["IN"] });

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: TEST_URL, max: 1 });
  await admin.query("drop schema if exists public cascade; create schema public;");
  await admin.query("drop schema if exists drizzle cascade; drop schema if exists pgboss cascade;");
  await admin.end();
  await runMigrations(TEST_URL);
  pool = new pg.Pool({ connectionString: TEST_URL, max: 4 });
  db = drizzle(pool, { schema });

  const [c] = await db
    .insert(schema.companies)
    .values({
      name: "Acme",
      normalizedName: "acme",
      atsProvider: "greenhouse",
      atsIdentifier: "acme",
    })
    .returning();
  companyId = c!.id;
});

describe("refreshCompany lifecycle", () => {
  it("NEW: first refresh ingests India jobs, rejects foreign, flags bare remote", async () => {
    state.body = ghListing([
      { id: 1, title: "Senior Product Manager", location: "Bengaluru, India" },
      { id: 2, title: "Sales Lead", location: "New York, NY" },
      { id: 3, title: "Backend Engineer", location: "Remote" },
    ]);
    const out = await refreshCompany(deps(), companyId, null);
    expect(out).toMatchObject({ new: 2, rejectedMarket: 1, updated: 0, removed: 0 });

    const rows = await db.select().from(schema.jobs);
    expect(rows).toHaveLength(2);
    const pm = rows.find((r) => r.externalId === "1")!;
    expect(pm).toMatchObject({
      status: "ACTIVE",
      version: 1,
      marketEligibility: "IN_CONFIRMED",
      normalizedTitle: "Product Manager",
      seniority: "senior",
    });
    expect(pm.descriptionHtml).toContain("<p>");
    const remote = rows.find((r) => r.externalId === "3")!;
    expect(remote.marketEligibility).toBe("REMOTE_UNVERIFIED");

    const versions = await db.select().from(schema.jobVersions);
    expect(versions.filter((v) => v.jobId === pm.id)).toHaveLength(1);
  });

  it("SAME: unchanged listing only touches lastSeenAt, no new versions", async () => {
    const before = await db.select().from(schema.jobs).where(eq(schema.jobs.externalId, "1"));
    const out = await refreshCompany(deps(), companyId, null);
    expect(out).toMatchObject({ new: 0, updated: 0, same: 2 });
    const after = await db.select().from(schema.jobs).where(eq(schema.jobs.externalId, "1"));
    expect(after[0]!.version).toBe(1);
    expect(after[0]!.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before[0]!.lastSeenAt.getTime());
  });

  it("UPDATED: content change bumps version and stores a snapshot", async () => {
    state.body = ghListing([
      {
        id: 1,
        title: "Senior Product Manager - Growth",
        location: "Bengaluru, India",
        content: "&lt;p&gt;Updated JD&lt;/p&gt;",
      },
      { id: 3, title: "Backend Engineer", location: "Remote" },
    ]);
    const out = await refreshCompany(deps(), companyId, null);
    expect(out.updated).toBe(1);
    const [pm] = await db.select().from(schema.jobs).where(eq(schema.jobs.externalId, "1"));
    expect(pm!.version).toBe(2);
    expect(pm!.title).toBe("Senior Product Manager - Growth");
    const versions = await db
      .select()
      .from(schema.jobVersions)
      .where(eq(schema.jobVersions.jobId, pm!.id));
    expect(versions).toHaveLength(2);
  });

  it("MISSING strike 1: absent job goes UNKNOWN, not REMOVED (PRD §30)", async () => {
    state.body = ghListing([
      {
        id: 1,
        title: "Senior Product Manager - Growth",
        location: "Bengaluru, India",
        content: "&lt;p&gt;Updated JD&lt;/p&gt;",
      },
    ]);
    const out = await refreshCompany(deps(), companyId, null);
    expect(out.unknown).toBe(1);
    const [be] = await db.select().from(schema.jobs).where(eq(schema.jobs.externalId, "3"));
    expect(be!.status).toBe("UNKNOWN");
  });

  it("provider error: NOTHING is removed, error is recorded (PRD §30, §116)", async () => {
    state.status = 500;
    const out = await refreshCompany(deps(), companyId, null);
    expect(out.error).toBeTruthy();
    expect(out.removed).toBe(0);
    const [be] = await db.select().from(schema.jobs).where(eq(schema.jobs.externalId, "3"));
    expect(be!.status).toBe("UNKNOWN"); // unchanged by the failed run
    const errors = await db.select().from(schema.crawlErrors);
    expect(errors.length).toBeGreaterThan(0);
    state.status = 200;
  });

  it("MISSING strike 2: still absent on a successful refresh → REMOVED", async () => {
    const out = await refreshCompany(deps(), companyId, null);
    expect(out.removed).toBe(1);
    const [be] = await db.select().from(schema.jobs).where(eq(schema.jobs.externalId, "3"));
    expect(be!.status).toBe("REMOVED");
  });

  it("REAPPEARS: removed job returns → ACTIVE again, no duplicate row (PRD §31)", async () => {
    state.body = ghListing([
      {
        id: 1,
        title: "Senior Product Manager - Growth",
        location: "Bengaluru, India",
        content: "&lt;p&gt;Updated JD&lt;/p&gt;",
      },
      { id: 3, title: "Backend Engineer", location: "Remote" },
    ]);
    const out = await refreshCompany(deps(), companyId, null);
    expect(out.reactivated).toBe(1);
    const rows = await db.select().from(schema.jobs).where(eq(schema.jobs.externalId, "3"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ACTIVE");
  });

  it("run accounting lands on refresh_runs when a runId is supplied", async () => {
    const [run] = await db
      .insert(schema.refreshRuns)
      .values({ scheduledAt: new Date(), status: "RUNNING" })
      .returning();
    state.body = ghListing([
      {
        id: 1,
        title: "Senior Product Manager - Growth",
        location: "Bengaluru, India",
        content: "&lt;p&gt;Updated JD&lt;/p&gt;",
      },
      { id: 3, title: "Backend Engineer", location: "Remote" },
      { id: 4, title: "Data Analyst", location: "Mumbai" },
    ]);
    await refreshCompany(deps(), companyId, run!.id);
    const [r] = await db
      .select()
      .from(schema.refreshRuns)
      .where(eq(schema.refreshRuns.id, run!.id));
    expect(r!.jobsNew).toBe(1);
    expect(r!.companiesProcessed).toBe(1);
  });
});
