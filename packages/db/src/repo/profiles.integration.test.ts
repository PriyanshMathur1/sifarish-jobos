import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema/index.ts";
import { runMigrations } from "../migrate.ts";
import * as profilesRepo from "./profiles.ts";

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://sifarish:sifarish@localhost:5432/sifarish_test";

let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;
let otherId: string;

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: TEST_URL, max: 1 });
  await admin.query("drop schema if exists public cascade; create schema public;");
  await admin.query("drop schema if exists drizzle cascade; drop schema if exists pgboss cascade;");
  await admin.end();
  await runMigrations(TEST_URL);
  db = drizzle(new pg.Pool({ connectionString: TEST_URL, max: 4 }), { schema });
  const [u] = await db.insert(schema.users).values({ email: "p@sifarish.local" }).returning();
  const [o] = await db.insert(schema.users).values({ email: "o@sifarish.local" }).returning();
  userId = u!.id;
  otherId = o!.id;
});

describe("profiles repo", () => {
  it("upserts application details without touching basics", async () => {
    await profilesRepo.upsertProfile(db, userId, {
      fullName: "Priyansh",
      currentTitle: "PM",
      yearsExperience: 5,
      skills: ["SQL"],
      locations: ["Bengaluru"],
    });
    await profilesRepo.upsertApplicationDetails(db, userId, {
      phone: "+91 99999",
      linkedinUrl: "https://linkedin.com/in/p",
      portfolioUrl: null,
      currentLocation: "Bengaluru",
      noticePeriodDays: 30,
      currentCtcLpa: 30,
      expectedCtcLpa: 40,
      workAuthorization: "Indian citizen",
      willingToRelocate: true,
    });
    const p = await profilesRepo.getProfile(db, userId);
    expect(p?.fullName).toBe("Priyansh");
    expect(p?.noticePeriodDays).toBe(30);
    expect(p?.skills).toEqual(["SQL"]);
  });

  it("stores resumes, first one default, owner-scoped reads", async () => {
    const a = await profilesRepo.addResume(db, userId, {
      label: "Default",
      fileName: "cv.pdf",
      mime: "application/pdf",
      content: Buffer.from("%PDF-1.4 fake"),
    });
    const b = await profilesRepo.addResume(db, userId, {
      label: "Fintech",
      fileName: "cv-fintech.pdf",
      mime: "application/pdf",
      content: Buffer.from("%PDF-1.4 fake2"),
    });
    let list = await profilesRepo.listResumes(db, userId);
    expect(list.map((r) => [r.label, r.isDefault])).toEqual([
      ["Default", true],
      ["Fintech", false],
    ]);

    await profilesRepo.setDefaultResume(db, userId, b);
    list = await profilesRepo.listResumes(db, userId);
    expect(list.find((r) => r.id === b)?.isDefault).toBe(true);
    expect(list.find((r) => r.id === a)?.isDefault).toBe(false);

    const file = await profilesRepo.getResumeFile(db, userId, a);
    expect(file?.content.toString()).toBe("%PDF-1.4 fake");
    expect(await profilesRepo.getResumeFile(db, otherId, a)).toBeNull();

    // Re-upload under the same label replaces bytes, keeps id count
    await profilesRepo.addResume(db, userId, {
      label: "Default",
      fileName: "cv-v2.pdf",
      mime: "application/pdf",
      content: Buffer.from("%PDF-1.4 v2"),
    });
    expect((await profilesRepo.listResumes(db, userId)).length).toBe(2);
    expect((await profilesRepo.getResumeFile(db, userId, a))?.fileName).toBe("cv-v2.pdf");

    await expect(
      profilesRepo.addResume(db, userId, {
        label: "Huge",
        fileName: "x.pdf",
        mime: "application/pdf",
        content: Buffer.alloc(profilesRepo.RESUME_MAX_BYTES + 1),
      }),
    ).rejects.toThrow(/too large/);
  });

  it("normalizes question keys so rewordings collide", () => {
    expect(profilesRepo.questionKey("What is your notice period?")).toBe("notice-period");
    expect(profilesRepo.questionKey("Notice Period (in days)")).toBe("notice-period");
    expect(profilesRepo.questionKey("Why do you want to work here?")).toBe("why-want-work-here");
  });

  it("upserts answers by key and scopes deletes", async () => {
    await profilesRepo.upsertAnswer(db, userId, "What is your notice period?", "30 days");
    await profilesRepo.upsertAnswer(db, userId, "Notice period (in days)", "45 days");
    const rows = await profilesRepo.listAnswers(db, userId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.answer).toBe("45 days");

    await profilesRepo.deleteAnswer(db, otherId, rows[0]!.id);
    expect((await profilesRepo.listAnswers(db, userId)).length).toBe(1);
    await profilesRepo.deleteAnswer(db, userId, rows[0]!.id);
    expect((await profilesRepo.listAnswers(db, userId)).length).toBe(0);
  });
});
