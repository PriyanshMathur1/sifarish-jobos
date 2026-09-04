import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../schema/index.ts";
import { runMigrations } from "../migrate.ts";
import * as applyRepo from "./apply.ts";

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://sifarish:sifarish@localhost:5432/sifarish_test";

let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;
let strongGh: string;
let strongLever: string;
let weakGh: string;
let strongJsonLd: string;

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: TEST_URL, max: 1 });
  await admin.query("drop schema if exists public cascade; create schema public;");
  await admin.query("drop schema if exists drizzle cascade; drop schema if exists pgboss cascade;");
  await admin.end();
  await runMigrations(TEST_URL);
  db = drizzle(new pg.Pool({ connectionString: TEST_URL, max: 4 }), { schema });

  const [u] = await db.insert(schema.users).values({ email: "apply@sifarish.local" }).returning();
  userId = u!.id;
  await db.insert(schema.profiles).values({ userId, fullName: "Priyansh Mathur", phone: "+91 1", noticePeriodDays: 30 });
  await db.insert(schema.answerBank).values({ userId, questionKey: "notice-period", questionText: "Notice period", answer: "30 days" });
  await db.insert(schema.resumes).values({ userId, label: "Default", fileName: "cv.pdf", mime: "application/pdf", bytes: 3, content: Buffer.from("pdf"), isDefault: true });

  const [gh] = await db.insert(schema.companies).values({ name: "Razorpay", normalizedName: "razorpay", atsProvider: "greenhouse" }).returning();
  const [lv] = await db.insert(schema.companies).values({ name: "Fam", normalizedName: "fam", atsProvider: "lever" }).returning();
  const [jl] = await db.insert(schema.companies).values({ name: "Other", normalizedName: "other", atsProvider: "generic-jsonld" }).returning();
  const mk = async (companyId: string, ext: string, applyUrl: string | null) => {
    const [j] = await db
      .insert(schema.jobs)
      .values({ companyId, externalId: ext, sourceProvider: "seed", title: "PM", normalizedTitle: "Product Manager", marketEligibility: "IN_CONFIRMED", contentHash: ext, applyUrl })
      .returning();
    return j!.id;
  };
  strongGh = await mk(gh!.id, "a", "https://boards.greenhouse.io/razorpay/jobs/1");
  weakGh = await mk(gh!.id, "b", "https://boards.greenhouse.io/razorpay/jobs/2");
  strongLever = await mk(lv!.id, "c", "https://jobs.lever.co/fam/abc");
  strongJsonLd = await mk(jl!.id, "d", "https://other.example/apply");
  const parts = { title: 30, skills: 20, seniority: 15, location: 10, freshness: 10 };
  await db.insert(schema.jobMatches).values([
    { userId, jobId: strongGh, score: 85, band: "strong", reasons: [], parts },
    { userId, jobId: weakGh, score: 40, band: "maybe", reasons: [], parts },
    { userId, jobId: strongLever, score: 80, band: "strong", reasons: [], parts },
    { userId, jobId: strongJsonLd, score: 90, band: "strong", reasons: [], parts },
  ]);
});

describe("apply queue", () => {
  it("queues strong matches at supported providers only, once", async () => {
    expect(await applyRepo.enqueueFromRules(db, userId)).toBe(2);
    expect(await applyRepo.enqueueFromRules(db, userId)).toBe(0);
    const list = await applyRepo.listAttempts(db, userId);
    expect(list.map((a) => a.jobId).sort()).toEqual([strongGh, strongLever].sort());
    expect(list.every((a) => a.status === "QUEUED" && a.reason === "band")).toBe(true);
  });

  it("queues saved jobs regardless of band, and refuses unsupported providers by hand", async () => {
    await db.insert(schema.userJobEvents).values({ userId, jobId: weakGh, type: "SAVE" });
    expect(await applyRepo.enqueueFromRules(db, userId)).toBe(1);
    expect((await applyRepo.attemptForJob(db, userId, weakGh))?.reason).toBe("saved");
    expect(await applyRepo.enqueueJob(db, userId, strongJsonLd)).toBe("unsupported");
    expect(await applyRepo.enqueueJob(db, userId, strongGh)).toBe("exists");
  });

  it("hands the runner a bundle capped by the daily limit, and claims are exclusive", async () => {
    await applyRepo.upsertRules(db, userId, { autoQueueBand: "strong", queueSaved: true, dailyCap: 2, mode: "confirm", maxAgeDays: 14 });
    const bundle = await applyRepo.runnerBundle(db, userId, 10);
    expect(bundle.email).toBe("apply@sifarish.local");
    expect(bundle.resume?.fileName).toBe("cv.pdf");
    expect(bundle.answers[0]?.key).toBe("notice-period");
    expect(bundle.profile?.noticePeriodDays).toBe(30);
    expect(bundle.attempts.length).toBe(2); // 3 queued, cap 2
    const first = bundle.attempts[0]!;
    expect(await applyRepo.markRunning(db, userId, first.id, "laptop")).toBe(true);
    expect(await applyRepo.markRunning(db, userId, first.id, "laptop")).toBe(false);
  });

  it("SUBMITTED lands in the tracker; BLOCKED keeps the question; requeue clears it", async () => {
    const list = await applyRepo.listAttempts(db, userId);
    const running = list.find((a) => a.status === "RUNNING")!;
    await applyRepo.reportAttempt(db, userId, running.id, { status: "SUBMITTED", screenshot: Buffer.from("jpg"), formUrl: "https://boards.greenhouse.io/x" });
    const [app] = await db.select().from(schema.applications).where(eq(schema.applications.jobId, running.jobId));
    expect(app?.status).toBe("APPLIED");
    expect(await applyRepo.submittedToday(db, userId)).toBe(1);
    expect((await applyRepo.screenshotFor(db, userId, running.id))?.toString()).toBe("jpg");

    const other = list.find((a) => a.status === "QUEUED")!;
    await applyRepo.markRunning(db, userId, other.id, "laptop");
    await applyRepo.reportAttempt(db, userId, other.id, { status: "BLOCKED", blocker: "unknown_question", blockerQuestion: "Favourite rail?", questions: ["Favourite rail?"] });
    let row = await applyRepo.attemptForJob(db, userId, other.jobId);
    expect(row?.status).toBe("BLOCKED");
    expect(row?.questions).toEqual(["Favourite rail?"]);
    await applyRepo.setAttemptStatus(db, userId, other.id, "QUEUED");
    row = await applyRepo.attemptForJob(db, userId, other.jobId);
    expect(row?.status).toBe("QUEUED");
    expect(row?.blocker).toBeNull();
  });

  it("device tokens resolve to their owner, once revoked they stop", async () => {
    const { token } = await applyRepo.createDeviceToken(db, userId, "laptop");
    expect(token.startsWith("sfr_")).toBe(true);
    const who = await applyRepo.userForDeviceToken(db, token);
    expect(who?.userId).toBe(userId);
    expect(await applyRepo.userForDeviceToken(db, "sfr_nope")).toBeNull();
    const [t] = await applyRepo.listDeviceTokens(db, userId);
    await applyRepo.revokeDeviceToken(db, userId, t!.id);
    expect(await applyRepo.userForDeviceToken(db, token)).toBeNull();
  });
});
