import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./helpers.ts";
import { users } from "./auth.ts";
import { jobs } from "./jobs.ts";
import { resumes } from "./profile.ts";

/**
 * Assisted apply (AUTOPILOT-PLAN A3 / Phase C). The queue is built server
 * side from match bands and rules; the runner on the user's own computer
 * pulls it, drives the ATS's hosted form in a real browser, and reports
 * back. Nothing here ever submits from the server.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const applyRules = pgTable("apply_rules", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** auto-queue jobs at or above this band; "none" = only saved jobs */
  autoQueueBand: text("auto_queue_band", { enum: ["strong", "good", "none"] })
    .notNull()
    .default("strong"),
  queueSaved: boolean("queue_saved").notNull().default(true),
  dailyCap: integer("daily_cap").notNull().default(10),
  /** confirm = prefill and wait for one click; handsoff = submit when no unknown questions */
  mode: text("mode", { enum: ["confirm", "handsoff"] }).notNull().default("confirm"),
  /** only queue jobs first seen within this many days */
  maxAgeDays: integer("max_age_days").notNull().default(14),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const applyAttempts = pgTable(
  "apply_attempts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["QUEUED", "RUNNING", "SUBMITTED", "BLOCKED", "FAILED", "SKIPPED", "CANCELLED"],
    })
      .notNull()
      .default("QUEUED"),
    /** why it was queued: band rule or a save */
    reason: text("reason").notNull().default("band"),
    mode: text("mode", { enum: ["confirm", "handsoff"] }).notNull().default("confirm"),
    formUrl: text("form_url"),
    provider: text("provider"),
    resumeId: uuid("resume_id").references(() => resumes.id, { onDelete: "set null" }),
    /** BLOCKED detail: captcha | login_wall | unknown_question | unsupported | no_resume | error */
    blocker: text("blocker"),
    blockerQuestion: text("blocker_question"),
    /** unknown questions the runner saw (so the user can answer several at once) */
    questions: jsonb("questions").$type<string[]>().notNull().default([]),
    screenshot: bytea("screenshot"),
    error: text("error"),
    runnerName: text("runner_name"),
    attempts: integer("attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("apply_attempts_user_job_uq").on(t.userId, t.jobId),
    index("apply_attempts_user_status_idx").on(t.userId, t.status),
  ],
);

/** Device tokens: how the runner on the user's computer authenticates. Hash only. */
export const deviceTokens = pgTable("device_tokens", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});
