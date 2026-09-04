import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@sifarish/db/schema/index";
import { runMigrations } from "@sifarish/db/migrate";
import { recomputeForUser } from "../matching/recompute.ts";
import { dispatchDigest, dispatchInstant, localParts } from "./alerts.ts";
import type { Notifier, NotifyMessage, NotifyTarget } from "./notifier.ts";

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://sifarish:sifarish@localhost:5432/sifarish_test";

class SpyNotifier implements Notifier {
  sent: Array<{ target: NotifyTarget; message: NotifyMessage }> = [];
  fail = false;
  async send(target: NotifyTarget, message: NotifyMessage) {
    if (this.fail) return { ok: false as const, error: "down" };
    this.sent.push({ target, message });
    return { ok: true as const };
  }
}

let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;
const TZ = "Asia/Kolkata";

/** A Date whose local hour in TZ equals `hour` today. */
function atLocalHour(hour: number): Date {
  const base = new Date();
  for (let h = -24; h <= 24; h += 1) {
    const d = new Date(base.getTime() + h * 3600_000);
    d.setUTCMinutes(30, 0, 0);
    if (localParts(d, TZ).hour === hour) return d;
  }
  throw new Error("unreachable");
}

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: TEST_URL, max: 1 });
  await admin.query("drop schema if exists public cascade; create schema public;");
  await admin.query("drop schema if exists drizzle cascade; drop schema if exists pgboss cascade;");
  await admin.end();
  await runMigrations(TEST_URL);
  db = drizzle(new pg.Pool({ connectionString: TEST_URL, max: 4 }), { schema });

  const [user] = await db.insert(schema.users).values({ email: "alerts@sifarish.local" }).returning();
  userId = user!.id;
  await db.insert(schema.profiles).values({
    userId,
    currentTitle: "Product Manager",
    yearsExperience: 5,
    skills: ["SQL", "Experimentation"],
    locations: ["Bengaluru"],
  });
  const [company] = await db
    .insert(schema.companies)
    .values({ name: "Razorpay", normalizedName: "razorpay" })
    .returning();
  await db.insert(schema.jobs).values([
    {
      companyId: company!.id,
      externalId: "strong",
      sourceProvider: "seed",
      title: "Senior Product Manager",
      normalizedTitle: "Product Manager",
      titleFunction: "Product",
      seniority: "senior",
      descriptionText: "SQL and a/b testing.",
      locations: ["Bengaluru"],
      marketEligibility: "IN_CONFIRMED",
      contentHash: "a",
    },
    {
      companyId: company!.id,
      externalId: "weak",
      sourceProvider: "seed",
      title: "Warehouse Associate",
      normalizedTitle: "Warehouse Associate",
      seniority: "entry",
      locations: ["Jaipur"],
      marketEligibility: "IN_CONFIRMED",
      contentHash: "b",
    },
  ]);
  await recomputeForUser(db, userId);
});

describe("instant alerts", () => {
  it("sends once per job at/above the band, then never again", async () => {
    const notifier = new SpyNotifier();
    const deps = { db, notifier, appUrl: "https://s.test", tz: TZ };
    expect(await dispatchInstant(deps, userId)).toBe(1);
    expect(notifier.sent[0]!.target).toEqual({ channel: "email", to: "alerts@sifarish.local" });
    expect(notifier.sent[0]!.message.subject).toMatch(/Senior Product Manager at Razorpay/);
    expect(notifier.sent[0]!.message.text).toContain("https://s.test/jobs/");

    expect(await dispatchInstant(deps, userId)).toBe(0);
    expect(notifier.sent.length).toBe(1);
  });

  it("does not record the alert when delivery fails, so it retries next tick", async () => {
    const [job] = await db
      .insert(schema.jobs)
      .values({
        companyId: (await db.select().from(schema.companies))[0]!.id,
        externalId: "strong2",
        sourceProvider: "seed",
        title: "Product Manager, Growth",
        normalizedTitle: "Product Manager",
        titleFunction: "Product",
        seniority: "manager",
        descriptionText: "SQL and experimentation.",
        locations: ["Bengaluru"],
        marketEligibility: "IN_CONFIRMED",
        contentHash: "c",
      })
      .returning();
    await recomputeForUser(db, userId);

    const notifier = new SpyNotifier();
    notifier.fail = true;
    const deps = { db, notifier, appUrl: "https://s.test", tz: TZ };
    expect(await dispatchInstant(deps, userId)).toBe(0);
    notifier.fail = false;
    expect(await dispatchInstant(deps, userId)).toBe(1);
    expect(notifier.sent[0]!.message.text).toContain(job!.id);
  });

  it("respects channel none", async () => {
    await db.insert(schema.alertPreferences).values({ userId, channel: "none" });
    const notifier = new SpyNotifier();
    expect(await dispatchInstant({ db, notifier, appUrl: "x", tz: TZ }, userId)).toBe(0);
    await db.update(schema.alertPreferences).set({ channel: "email" }).where(eq(schema.alertPreferences.userId, userId));
  });
});

describe("digest", () => {
  it("is not due before the hour, sends once at/after it, then waits for tomorrow", async () => {
    const notifier = new SpyNotifier();
    const deps = { db, notifier, appUrl: "https://s.test", tz: TZ };

    expect(await dispatchDigest(deps, userId, atLocalHour(7))).toBe(-1);
    const n = await dispatchDigest(deps, userId, atLocalHour(10));
    expect(n).toBeGreaterThanOrEqual(2);
    expect(notifier.sent[0]!.message.subject).toMatch(/Sifarish daily/);
    expect(await dispatchDigest(deps, userId, atLocalHour(12))).toBe(-1);
    expect(notifier.sent.length).toBe(1);

    // force sends regardless and does not consume today's slot
    await db.update(schema.alertPreferences).set({ lastDigestAt: null }).where(eq(schema.alertPreferences.userId, userId));
    expect(await dispatchDigest(deps, userId, atLocalHour(7), { force: true })).toBeGreaterThanOrEqual(2);
    expect(await dispatchDigest(deps, userId, atLocalHour(10))).toBeGreaterThanOrEqual(2);
  });
});
