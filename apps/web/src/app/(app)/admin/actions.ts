"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadConfig, logger, PgBossQueue, QUEUES, registerHandlers, SafeFetcher, discoverContacts, emailHash } from "@sifarish/core";
import { orchestrateRefresh, completeFinishedRuns } from "@sifarish/core/ingestion/orchestrator";
import { getDb, schema, audit, contactsRepo } from "@sifarish/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/session";

/**
 * Admin refresh controls (PRD §145) — every action audited. Runs drain
 * inline so they work in dev without the long-lived worker.
 */

async function withQueue<T>(fn: (q: PgBossQueue) => Promise<T>): Promise<T> {
  const config = loadConfig();
  const queue = new PgBossQueue(config.DATABASE_URL);
  await queue.start();
  try {
    registerHandlers(queue, config, { mode: "drain" });
    return await fn(queue);
  } finally {
    await queue.stop();
  }
}

export async function runGlobalRefresh(): Promise<void> {
  const { userId } = await requireAdmin();
  const db = getDb();
  await audit(db, { actorId: userId, action: "admin.refresh.global", subjectType: "system" });
  await withQueue(async (queue) => {
    const { runId } = await orchestrateRefresh(db, queue, "manual");
    const refreshed = await queue.drain(QUEUES.refreshCompany, 500);
    await completeFinishedRuns(db);
    logger.info({ runId, refreshed }, "manual global refresh complete");
  });
  revalidatePath("/admin");
}

export async function refreshOneCompany(companyId: string): Promise<void> {
  const { userId } = await requireAdmin();
  const id = z.string().uuid().parse(companyId);
  const db = getDb();
  await audit(db, {
    actorId: userId,
    action: "admin.refresh.company",
    subjectType: "company",
    subjectId: id,
  });
  await withQueue(async (queue) => {
    await queue.enqueue(
      QUEUES.refreshCompany,
      { companyId: id, runId: null },
      { singletonKey: `manual:${id}` },
    );
    await queue.drain(QUEUES.refreshCompany, 5);
  });
  revalidatePath("/admin");
}

export async function toggleCompanyStatus(companyId: string): Promise<void> {
  const { userId } = await requireAdmin();
  const id = z.string().uuid().parse(companyId);
  const db = getDb();
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  if (!c) return;
  const next = c.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  await db.update(schema.companies).set({ status: next }).where(eq(schema.companies.id, id));
  await audit(db, {
    actorId: userId,
    action: `admin.company.${next.toLowerCase()}`,
    subjectType: "company",
    subjectId: id,
  });
  revalidatePath("/admin");
}

/** Watch tier = refreshed on every ticker call (15 min) instead of hourly. */
export async function toggleCompanyPriority(companyId: string): Promise<void> {
  const { userId } = await requireAdmin();
  const id = z.string().uuid().parse(companyId);
  const db = getDb();
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  if (!c) return;
  const next = c.priority === "watch" ? "normal" : "watch";
  await db.update(schema.companies).set({ priority: next }).where(eq(schema.companies.id, id));
  await audit(db, {
    actorId: userId,
    action: `admin.company.priority.${next}`,
    subjectType: "company",
    subjectId: id,
  });
  revalidatePath("/admin");
}

/** Company-owned page ContactDiscovery may read (team/about/leadership). */
export async function addCompanyPage(formData: FormData): Promise<void> {
  const { userId } = await requireAdmin();
  const companyId = z.string().uuid().parse(formData.get("companyId"));
  const url = z.string().url().max(500).parse(formData.get("url"));
  const kind = z.enum(["team", "about", "leadership", "other"]).parse(formData.get("kind") ?? "team");
  const db = getDb();
  await db.insert(schema.companyPages).values({ companyId, url, kind }).onConflictDoNothing();
  await audit(db, { actorId: userId, action: "admin.company_page.add", subjectType: "company", subjectId: companyId, meta: { url } });
  revalidatePath("/admin");
}

export async function removeCompanyPage(pageId: string): Promise<void> {
  const { userId } = await requireAdmin();
  const id = z.string().uuid().parse(pageId);
  const db = getDb();
  await db.delete(schema.companyPages).where(eq(schema.companyPages.id, id));
  await audit(db, { actorId: userId, action: "admin.company_page.remove", subjectType: "company_page", subjectId: id });
  revalidatePath("/admin");
}

/**
 * Discover all: run ContactDiscovery over every curated page. Contacts land
 * in the ADMIN's contact list (single-user product); provenance recorded,
 * suppression honoured, nothing fabricated.
 */
export async function discoverAllCompanyPages(): Promise<void> {
  const { userId } = await requireAdmin();
  const config = loadConfig();
  if (!config.CONTACT_DISCOVERY) return;
  const db = getDb();
  const pages = await db.select().from(schema.companyPages);
  const fetcher = new SafeFetcher();
  let found = 0;
  for (const page of pages) {
    const result = await discoverContacts(fetcher, page.url);
    let n = 0;
    if (result.ok) {
      for (const person of result.value) {
        if (person.email) {
          const [suppressed] = await db
            .select({ id: schema.contactSuppressions.id })
            .from(schema.contactSuppressions)
            .where(eq(schema.contactSuppressions.emailHash, emailHash(person.email)));
          if (suppressed) continue;
        }
        await contactsRepo.createContact(db, userId, {
          fullName: person.fullName,
          title: person.title,
          companyId: page.companyId,
          businessEmail: person.email,
          emailStatus: person.email ? "VERIFIED" : "UNKNOWN",
          professionalUrls: person.url ? [person.url] : [],
          sourceType: "discovered",
          sourceUrl: person.sourceUrl,
        });
        n += 1;
      }
    }
    await db
      .update(schema.companyPages)
      .set({ lastDiscoveredAt: new Date(), lastFound: n })
      .where(eq(schema.companyPages.id, page.id));
    found += n;
  }
  await audit(db, { actorId: userId, action: "admin.discover_all", subjectType: "system", meta: { pages: pages.length, found } });
  logger.info({ pages: pages.length, found }, "discover all complete");
  revalidatePath("/admin");
  revalidatePath("/contacts");
}
