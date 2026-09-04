"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadConfig, logger, PgBossQueue, QUEUES, registerHandlers } from "@sifarish/core";
import { orchestrateRefresh, completeFinishedRuns } from "@sifarish/core/ingestion/orchestrator";
import { getDb, schema, audit } from "@sifarish/db";
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
