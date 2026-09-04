import { getDb } from "@sifarish/db";
import type { AppConfig } from "./config.ts";
import type { JobHandler, Queue } from "./queue/queue.ts";
import { QUEUES } from "./queue/queue.ts";
import { SafeFetcher } from "./fetch/safe-fetcher.ts";
import { refreshCompany } from "./ingestion/ingest.ts";
import { orchestrateRefresh, findMissedSlot, tickRefresh } from "./ingestion/orchestrator.ts";
import { logger } from "./logger.ts";
import { recomputeForCompany, recomputeForUser } from "./matching/recompute.ts";
import { matchesRepo, applyRepo } from "@sifarish/db";
import { buildNotifier } from "./notify/build.ts";
import { dispatchDigest, dispatchInstant } from "./notify/alerts.ts";
import { drainCampaigns, syncReplies, type CampaignDeps } from "./outreach/campaigns.ts";
import { gmailClientForUser, hasScope, GMAIL_SCOPE } from "./outreach/gmail-accounts.ts";

export type HandlerMode = "worker" | "drain";

/**
 * Queue handler registry — the one place queue names meet implementations.
 * The SAME handlers serve both invocation modes (grill G8):
 * - "worker": long-lived process, handlers poll (queue.work)
 * - "drain":  serverless cron, handlers attached then drained (queue.register)
 * Handlers MUST be idempotent (PRD §106) — refreshCompany re-runs are
 * all-SAME, orchestrate fan-out is singleton-keyed per run.
 */
export function registerHandlers(
  queue: Queue,
  config: AppConfig,
  opts: { mode: HandlerMode },
): void {
  const db = getDb();
  const fetcher = new SafeFetcher();
  const alertDeps = { db, notifier: buildNotifier(config), appUrl: config.APP_URL, tz: config.APP_TZ };

  const attach = <T extends object>(name: string, handler: JobHandler<T>): void => {
    if (opts.mode === "worker") {
      void queue.work(name, handler);
    } else {
      queue.register(name, handler);
    }
  };

  attach<{ recovery?: boolean; slot?: string }>(QUEUES.refreshOrchestrate, async (payload, ctx) => {
    const trigger = payload.recovery ? "recovery" : "cron";
    const scheduledFor = payload.slot ? new Date(payload.slot) : new Date();
    logger.info({ jobId: ctx.jobId, trigger }, "refresh orchestrate tick");
    await orchestrateRefresh(db, queue, trigger, scheduledFor);
    // Freshness decays daily, so every run also re-scores the whole graph
    // once the fan-out has landed (singleton per slot: retries never double it).
    await queue.enqueue(
      QUEUES.matchRecompute,
      { slot: scheduledFor.toISOString() },
      { singletonKey: `match:${scheduledFor.toISOString().slice(0, 13)}` },
    );
  });

  attach<{ slot?: string; userId?: string }>(QUEUES.matchRecompute, async (payload, ctx) => {
    const userIds = payload.userId ? [payload.userId] : await matchesRepo.userIdsWithProfiles(db);
    let total = 0;
    for (const userId of userIds) total += await recomputeForUser(db, userId);
    logger.info({ jobId: ctx.jobId, users: userIds.length, matches: total }, "match recompute tick");
  });

  attach<{ companyId: string; runId: string | null }>(
    QUEUES.refreshCompany,
    async (payload, ctx) => {
      const outcome = await refreshCompany(
        { db, fetcher, marketCountries: config.MARKET_COUNTRIES },
        payload.companyId,
        payload.runId,
      );
      logger.info(
        { jobId: ctx.jobId, companyId: payload.companyId, ...outcome },
        "company refreshed",
      );
      // Score what just changed for every profiled user. Same handler, same
      // idempotency: a retry re-scores to identical rows.
      if (outcome.new + outcome.updated + outcome.reactivated > 0) {
        await recomputeForCompany(db, payload.companyId);
        for (const userId of await matchesRepo.userIdsWithProfiles(db)) {
          await dispatchInstant(alertDeps, userId);
        }
      }
    },
  );

  /** Worker-mode tier ticks: watch every call, normal once an hour. */
  attach<{ slot?: string }>(QUEUES.tierTick, async (_payload, ctx) => {
    const now = new Date();
    const watch = await tickRefresh(db, queue, "watch", now);
    const normal = now.getMinutes() < 15 ? await tickRefresh(db, queue, "normal", now) : { companies: 0 };
    logger.info({ jobId: ctx.jobId, watch: watch.companies, normal: normal.companies }, "tier tick");
  });

  /**
   * Autopilot tick (every ticker call / every 15 min in worker mode):
   * alerts (instant catch-up + digest when due), campaign sends inside the
   * rails, and reply/bounce sync over threads we started.
   */
  attach<{ slot?: string }>(QUEUES.autopilotTick, async (_payload, ctx) => {
    let instant = 0;
    let digests = 0;
    let sent = 0;
    let replied = 0;
    let bounced = 0;
    let queuedApplies = 0;
    for (const userId of await matchesRepo.userIdsWithProfiles(db)) {
      instant += await dispatchInstant(alertDeps, userId);
      if ((await dispatchDigest(alertDeps, userId)) >= 0) digests += 1;
      // Apply queue from rules (the runner on the user's PC drains it).
      queuedApplies += await applyRepo.enqueueFromRules(db, userId);

      if (!config.OUTREACH_DIRECT_SEND) continue;
      const gmail = await gmailClientForUser(db, config, userId);
      if (!gmail || !hasScope(gmail.scopes, GMAIL_SCOPE.send)) continue;
      const campaignDeps: CampaignDeps = {
        db,
        gmail: gmail.client,
        directSendEnabled: true,
        dailyCapMax: config.CAMPAIGN_DAILY_CAP_MAX,
        perCompanyPer14d: config.CAMPAIGN_PER_COMPANY_14D,
        warmupDays: config.CAMPAIGN_WARMUP_DAYS,
        warmupDailyCap: config.CAMPAIGN_WARMUP_DAILY_CAP,
        tickSeconds: 900,
        messageIdHost: new URL(config.APP_URL).hostname,
        userEmail: gmail.email,
      };
      const drained = await drainCampaigns(campaignDeps, userId);
      sent += drained.sent;
      if (hasScope(gmail.scopes, GMAIL_SCOPE.metadata)) {
        const synced = await syncReplies(campaignDeps, userId);
        replied += synced.replied;
        bounced += synced.bounced;
      }
    }
    logger.info({ jobId: ctx.jobId, instant, digests, queuedApplies, sent, replied, bounced }, "autopilot tick");
  });

  attach(QUEUES.cleanup, async (_payload, ctx) => {
    logger.info({ jobId: ctx.jobId }, "cleanup tick");
  });
}

/**
 * Missed-run recovery (PRD §144): call on worker boot or before a cron
 * drain. At most one catch-up run per missed slot (singleton key = slot).
 */
export async function recoverMissedRun(queue: Queue, config: AppConfig): Promise<boolean> {
  const db = getDb();
  const missed = await findMissedSlot(db, config.JOB_REFRESH_SCHEDULE, config.APP_TZ);
  if (!missed) return false;
  logger.warn({ missedSlot: missed.toISOString() }, "missed refresh slot — scheduling recovery");
  await queue.enqueue(
    QUEUES.refreshOrchestrate,
    { recovery: true, slot: missed.toISOString() },
    { singletonKey: `recovery:${missed.toISOString()}` },
  );
  return true;
}
