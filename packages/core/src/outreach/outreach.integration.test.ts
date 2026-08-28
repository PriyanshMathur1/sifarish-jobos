import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@sifarish/db/schema/index";
import { runMigrations } from "@sifarish/db/migrate";
import { prepareOutreach, approveOutreach, emailHash } from "./outreach.ts";
import { FakeGmailClient } from "./gmail.ts";
import { BUILTIN_TEMPLATES } from "./template-renderer.ts";

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://sifarish:sifarish@localhost:5432/sifarish_test";

let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;
let contactId: string;
let jobId: string;
let templateId: string;

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: TEST_URL, max: 1 });
  await admin.query("drop schema if exists public cascade; create schema public;");
  await admin.query("drop schema if exists drizzle cascade; drop schema if exists pgboss cascade;");
  await admin.end();
  await runMigrations(TEST_URL);
  db = drizzle(new pg.Pool({ connectionString: TEST_URL, max: 4 }), { schema });

  const [user] = await db.insert(schema.users).values({ email: "sender@sifarish.local" }).returning();
  userId = user!.id;
  await db.insert(schema.profiles).values({
    userId,
    fullName: "Priyansh Mathur",
    currentTitle: "Product Manager",
    skills: ["Growth", "SQL", "Experimentation"],
  });

  const [company] = await db
    .insert(schema.companies)
    .values({ name: "Razorpay", normalizedName: "razorpay", domain: "razorpay.com" })
    .returning();

  const [job] = await db
    .insert(schema.jobs)
    .values({
      companyId: company!.id,
      externalId: "j1",
      sourceProvider: "seed",
      title: "Senior Product Manager - Payments",
      normalizedTitle: "Product Manager",
      descriptionText: "Own payments growth. SQL and experimentation experience preferred.",
      marketEligibility: "IN_CONFIRMED",
      contentHash: "x",
    })
    .returning();
  jobId = job!.id;

  const [contact] = await db
    .insert(schema.contacts)
    .values({
      userId,
      companyId: company!.id,
      fullName: "Anita Desai",
      title: "Talent Partner",
      businessEmail: "anita.desai@razorpay.com",
      emailStatus: "PROBABLE",
      sourceType: "manual",
    })
    .returning();
  contactId = contact!.id;

  const builtin = BUILTIN_TEMPLATES.find((t) => t.kind === "recruiter_intro")!;
  const [tpl] = await db
    .insert(schema.templates)
    .values({ ...builtin, isBuiltin: true, userId: null })
    .returning();
  templateId = tpl!.id;
});

describe("prepareOutreach", () => {
  it("resolves every variable from contact + job + profile", async () => {
    const r = await prepareOutreach(db as never, userId, { contactId, jobId, templateId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.toEmail).toBe("anita.desai@razorpay.com");
    expect(r.value.subject).toContain("Senior Product Manager - Payments");
    expect(r.value.body).toContain("Hi Anita,");
    expect(r.value.body).toContain("Growth"); // relevant_skill = first profile skill in JD
    expect(r.value.body).toContain("Priyansh Mathur");
    expect(r.value.body).not.toContain("{{");
  });

  it("without a job, missing variables are reported for the user to fill", async () => {
    const r = await prepareOutreach(db as never, userId, { contactId, templateId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ kind: "missing_vars" });
    if (r.error.kind === "missing_vars") {
      expect(r.error.missing).toEqual(expect.arrayContaining(["job_title", "relevant_skill"]));
    }
  });

  it("overrides fill the gaps", async () => {
    const r = await prepareOutreach(db as never, userId, {
      contactId,
      templateId,
      overrides: { job_title: "PM roles", relevant_skill: "Growth" },
    });
    expect(r.ok).toBe(true);
  });
});

describe("approveOutreach", () => {
  const deps = (gmail: FakeGmailClient, opts: Partial<{ send: boolean; cap: number }> = {}) => ({
    db: db as never,
    gmail,
    directSendEnabled: opts.send ?? false,
    dailySendCap: opts.cap ?? 25,
  });

  it("draft mode: creates a Gmail draft, records DRAFTED, bumps CRM to CONTACTED", async () => {
    const gmail = new FakeGmailClient();
    const prep = await prepareOutreach(db as never, userId, { contactId, jobId, templateId });
    if (!prep.ok) throw new Error("prepare failed");
    const r = await approveOutreach(
      deps(gmail),
      userId,
      { contactId, jobId, templateId, subject: prep.value.subject, body: prep.value.body },
      "draft",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("DRAFTED");
    expect(gmail.drafts).toHaveLength(1);
    expect(gmail.drafts[0]!.to).toBe("anita.desai@razorpay.com");

    const [app] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.jobId, jobId));
    expect(app!.status).toBe("CONTACTED");
  });

  it("recipient dedup blocks a repeat within the window", async () => {
    const gmail = new FakeGmailClient();
    const r = await approveOutreach(
      deps(gmail),
      userId,
      { contactId, jobId, templateId, subject: "again", body: "again" },
      "draft",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("duplicate_recipient");
    expect(gmail.drafts).toHaveLength(0);
  });

  it("the recipient is derived server-side from the owner-scoped contact — a foreign contactId is refused", async () => {
    const [stranger] = await db
      .insert(schema.users)
      .values({ email: "other@sifarish.local" })
      .returning();
    const [foreign] = await db
      .insert(schema.contacts)
      .values({
        userId: stranger!.id,
        fullName: "Not Yours",
        businessEmail: "notyours@razorpay.com",
      })
      .returning();
    const gmail = new FakeGmailClient();
    const r = await approveOutreach(
      deps(gmail),
      userId,
      { contactId: foreign!.id, jobId: null, templateId, subject: "s", body: "b" },
      "draft",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
    expect(gmail.drafts).toHaveLength(0);
  });

  it("send mode is refused when the flag is off", async () => {
    const gmail = new FakeGmailClient();
    const r = await approveOutreach(
      deps(gmail),
      userId,
      { contactId, jobId, templateId, subject: "s", body: "b" },
      "send",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("send_disabled");
  });

  it("daily cap blocks sends past the limit (PRD §80)", async () => {
    const gmail = new FakeGmailClient();
    const d = deps(gmail, { send: true, cap: 2 });
    const mk = async (n: number) => {
      const [c] = await db
        .insert(schema.contacts)
        .values({ userId, fullName: `Person ${n}`, businessEmail: `person${n}@razorpay.com` })
        .returning();
      return c!.id;
    };
    for (const n of [1, 2]) {
      const r = await approveOutreach(
        d,
        userId,
        { contactId: await mk(n), jobId: null, templateId, subject: "s", body: "b" },
        "send",
      );
      expect(r.ok).toBe(true);
    }
    const r3 = await approveOutreach(
      d,
      userId,
      { contactId: await mk(3), jobId: null, templateId, subject: "s", body: "b" },
      "send",
    );
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error).toMatchObject({ kind: "cap_reached", cap: 2 });
    expect(gmail.sent).toHaveLength(2);
  });

  it("suppressed recipients are refused at approval time (PRD §75)", async () => {
    await db.insert(schema.contactSuppressions).values({
      emailHash: emailHash("optout@razorpay.com"),
      domain: "razorpay.com",
    });
    const [c] = await db
      .insert(schema.contacts)
      .values({ userId, fullName: "Opt Out", businessEmail: "optout@razorpay.com" })
      .returning();
    const gmail = new FakeGmailClient();
    const r = await approveOutreach(
      deps(gmail),
      userId,
      { contactId: c!.id, jobId: null, templateId, subject: "s", body: "b" },
      "draft",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("suppressed");
  });

  it("a Gmail failure preserves the message as FAILED — never lost (PRD §123)", async () => {
    const [c] = await db
      .insert(schema.contacts)
      .values({ userId, fullName: "Keeper", businessEmail: "keeper@razorpay.com" })
      .returning();
    const gmail = new FakeGmailClient();
    gmail.failNext = { kind: "network", detail: "offline" };
    const r = await approveOutreach(
      deps(gmail),
      userId,
      { contactId: c!.id, jobId: null, templateId, subject: "precious", body: "text" },
      "draft",
    );
    expect(r.ok).toBe(false);
    const [row] = await db
      .select()
      .from(schema.outreachMessages)
      .where(eq(schema.outreachMessages.toEmail, "keeper@razorpay.com"));
    expect(row!.status).toBe("FAILED");
    expect(row!.subject).toBe("precious");
    expect(row!.error).toContain("network");
  });
});
