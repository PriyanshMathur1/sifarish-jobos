import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@sifarish/db/schema/index";
import { runMigrations } from "@sifarish/db/migrate";
import { FakeGmailClient } from "./gmail.ts";
import { BUILTIN_TEMPLATES } from "./template-renderer.ts";
import { createCampaign, drainCampaigns, setCampaignStatus, syncReplies, UNSUBSCRIBE_LINE, type CampaignDeps } from "./campaigns.ts";

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://sifarish:sifarish@localhost:5432/sifarish_test";

let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;
let companyA: string;
let jobId: string;
let introTemplate: string;
let followupTemplate: string;
const contactIds: string[] = [];
let gmail: FakeGmailClient;
let deps: CampaignDeps;

const DAY = 86_400_000;

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: TEST_URL, max: 1 });
  await admin.query("drop schema if exists public cascade; create schema public;");
  await admin.query("drop schema if exists drizzle cascade; drop schema if exists pgboss cascade;");
  await admin.end();
  await runMigrations(TEST_URL);
  db = drizzle(new pg.Pool({ connectionString: TEST_URL, max: 4 }), { schema });

  const [user] = await db.insert(schema.users).values({ email: "me@sifarish.local" }).returning();
  userId = user!.id;
  await db.insert(schema.profiles).values({ userId, fullName: "Priyansh Mathur", currentTitle: "Product Manager", skills: ["SQL"] });

  const [a] = await db.insert(schema.companies).values({ name: "Razorpay", normalizedName: "razorpay", domain: "razorpay.com" }).returning();
  const [b] = await db.insert(schema.companies).values({ name: "Postman", normalizedName: "postman", domain: "postman.com" }).returning();
  companyA = a!.id;
  const [job] = await db
    .insert(schema.jobs)
    .values({
      companyId: companyA,
      externalId: "j1",
      sourceProvider: "seed",
      title: "Senior Product Manager",
      normalizedTitle: "Product Manager",
      descriptionText: "SQL heavy role.",
      marketEligibility: "IN_CONFIRMED",
      contentHash: "x",
    })
    .returning();
  jobId = job!.id;

  for (const [i, [name, company]] of ([
    ["Anita Desai", a!.id],
    ["Rohan Mehta", a!.id],
    ["Kiran Rao", a!.id],
    ["Sana Khan", b!.id],
    ["No Email", b!.id],
  ] as const).entries()) {
    const [c] = await db
      .insert(schema.contacts)
      .values({
        userId,
        companyId: company,
        fullName: name,
        title: "Recruiter",
        businessEmail: i === 4 ? null : `${name.toLowerCase().replace(" ", ".")}@example.com`,
        emailStatus: "PROBABLE",
        sourceType: "manual",
      })
      .returning();
    contactIds.push(c!.id);
  }

  const intro = BUILTIN_TEMPLATES.find((t) => t.kind === "recruiter_intro")!;
  const follow = BUILTIN_TEMPLATES.find((t) => t.kind === "followup")!;
  const [t1] = await db.insert(schema.templates).values({ ...intro, isBuiltin: true, userId: null }).returning();
  const [t2] = await db.insert(schema.templates).values({ ...follow, isBuiltin: true, userId: null }).returning();
  introTemplate = t1!.id;
  followupTemplate = t2!.id;

  gmail = new FakeGmailClient();
  deps = {
    db,
    gmail,
    directSendEnabled: true,
    dailyCapMax: 100,
    perCompanyPer14d: 2,
    warmupDays: 0,
    warmupDailyCap: 10,
    tickSeconds: 900,
    messageIdHost: "sifarish.test",
    userEmail: "me@sifarish.local",
  };
});

describe("campaigns", () => {
  let campaignId: string;

  it("creates in DRAFT and pre-skips contacts that cannot be mailed", async () => {
    const r = await createCampaign(db, userId, {
      name: "Sept push",
      jobId,
      contactIds,
      steps: [
        { day: 0, templateId: introTemplate },
        { day: 3, templateId: followupTemplate },
      ],
      dailyCap: 40,
      spacingSec: 120,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    campaignId = r.value.campaignId;
    expect(r.value.queued).toBe(4);
    expect(r.value.skipped).toBe(1);
    const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
    expect(c?.status).toBe("DRAFT");
  });

  it("does nothing until approved", async () => {
    const out = await drainCampaigns(deps, userId);
    expect(out.sent).toBe(0);
    expect(gmail.sent.length).toBe(0);
  });

  it("sends inside spacing and per-company caps once RUNNING", async () => {
    expect(await setCampaignStatus(db, userId, campaignId, "RUNNING")).toBe(true);
    const now = new Date();
    const out = await drainCampaigns(deps, userId, now);
    // 900s / 120s = 7 allowed per tick; 4 queued; company cap 2 for Razorpay → 3 sent, 1 skipped
    expect(out.sent).toBe(3);
    expect(out.skipped).toBe(1);
    expect(gmail.sent.length).toBe(3);
    expect(gmail.sent[0]!.body).toContain(UNSUBSCRIBE_LINE);
    expect(gmail.sent[0]!.messageId).toMatch(/@sifarish.test>$/);

    const recips = await db.select().from(schema.campaignRecipients).where(eq(schema.campaignRecipients.campaignId, campaignId));
    const byState = Object.fromEntries(recips.map((r) => [r.contactId, r]));
    expect(byState[contactIds[2]!]?.state).toBe("SKIPPED");
    expect(byState[contactIds[2]!]?.skipReason).toMatch(/company cap/);
    expect(byState[contactIds[0]!]?.state).toBe("WAITING");
    expect(byState[contactIds[0]!]?.step).toBe(1);

    const msgs = await db.select().from(schema.outreachMessages).where(eq(schema.outreachMessages.userId, userId));
    expect(msgs.every((m) => m.campaignId === campaignId && m.status === "SENT" && m.rfcMessageId)).toBe(true);
  });

  it("holds follow-ups until due, then replies in-thread with Re:", async () => {
    const soon = new Date(Date.now() + 1 * DAY);
    expect((await drainCampaigns(deps, userId, soon)).sent).toBe(0);

    const later = new Date(Date.now() + 3 * DAY + 1000);
    const out = await drainCampaigns(deps, userId, later);
    expect(out.sent).toBe(3);
    const follow = gmail.sent.slice(3);
    expect(follow.every((m) => m.subject.startsWith("Re: ") && m.thread?.inReplyTo)).toBe(true);
    expect(follow[0]!.thread!.threadId).toBe("fake-thread-1");

    const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
    expect(c?.status).toBe("DONE");
  });

  it("detects replies and bounces and stops sequences", async () => {
    // Fresh campaign with a follow-up so we can see it stop.
    const r = await createCampaign(db, userId, {
      name: "Second",
      jobId,
      contactIds: [contactIds[3]!],
      steps: [
        { day: 0, templateId: introTemplate },
        { day: 2, templateId: followupTemplate },
      ],
      dailyCap: 40,
      spacingSec: 60,
    });
    // Sana was contacted in the last 14 days by campaign 1 → pre-skipped
    expect(r.ok && r.value.skipped).toBe(1);

    // Simulate a reply on Anita's thread and a bounce on Rohan's.
    gmail.threads.get("fake-thread-1")!.push({ id: "r1", from: "Anita Desai <anita.desai@example.com>", subject: "Re: hi", date: new Date(), sent: false });
    gmail.threads.get("fake-thread-2")!.push({ id: "b1", from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)", date: new Date(), sent: false });

    const synced = await syncReplies(deps, userId);
    expect(synced.replied).toBe(1);
    expect(synced.bounced).toBe(1);

    const [rohan] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactIds[1]!));
    expect(rohan?.emailStatus).toBe("INVALID");
    const msgs = await db.select().from(schema.outreachMessages).where(eq(schema.outreachMessages.contactId, contactIds[0]!));
    expect(msgs.some((m) => m.status === "REPLIED")).toBe(true);

    // second sync is a no-op (already terminal)
    const again = await syncReplies(deps, userId);
    expect(again.replied + again.bounced).toBe(0);
  });

  it("pauses everything when the bounce rate crosses 5% on 10+ sends", async () => {
    // Fabricate a bad day: 10 sends, 2 bounced.
    const [c] = await db.insert(schema.campaigns).values({ userId, name: "x", jobId, steps: [{ day: 0, templateId: introTemplate }], status: "RUNNING" }).returning();
    for (let i = 0; i < 10; i += 1) {
      await db.insert(schema.outreachMessages).values({
        userId,
        contactId: contactIds[0]!,
        templateId: introTemplate,
        toEmail: `x${i}@example.com`,
        subject: "s",
        body: "b",
        mode: "send",
        status: i < 2 ? "BOUNCED" : "SENT",
      });
    }
    const out = await drainCampaigns(deps, userId);
    expect(out.pausedForBounces).toBe(true);
    const [after] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, c!.id));
    expect(after?.status).toBe("PAUSED");
    expect(after?.pauseReason).toMatch(/bounce/);
  });
});
