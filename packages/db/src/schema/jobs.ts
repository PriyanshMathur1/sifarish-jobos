import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  customType,
} from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./helpers.ts";
import { users } from "./auth.ts";

/** Job graph (SPEC §3). Provenance-first: source facts vs Sifarish observations
 *  are separate columns and never conflated (PRD §34). */

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const companies = pgTable(
  "companies",
  {
    id: id(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    domain: text("domain"),
    careersUrl: text("careers_url"),
    atsProvider: text("ats_provider", {
      enum: ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "generic-jsonld"],
    }),
    atsIdentifier: text("ats_identifier"),
    industry: text("industry"),
    companySize: text("company_size"),
    hq: text("hq"),
    status: text("status", { enum: ["ACTIVE", "PAUSED", "UNSUPPORTED"] })
      .notNull()
      .default("ACTIVE"),
    /** Refresh tier (Autopilot A1): watch = every ticker call, normal = hourly. */
    priority: text("priority", { enum: ["watch", "normal"] }).notNull().default("normal"),
    detectionConfidence: text("detection_confidence", { enum: ["high", "medium", "low"] }),
    /** Consecutive failed checks — persistent circuit-break input (PRD §97). */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastSuccessfulCheckAt: timestamp("last_successful_check_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("companies_ats_uq").on(t.atsProvider, t.atsIdentifier),
    uniqueIndex("companies_name_domain_uq").on(t.normalizedName, t.domain),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    sourceProvider: text("source_provider").notNull(),

    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    titleFunction: text("title_function"),
    seniority: text("seniority").notNull().default("mid"),

    descriptionHtml: text("description_html"),
    descriptionText: text("description_text"),

    locations: jsonb("locations").$type<string[]>().notNull().default([]),
    remoteType: text("remote_type", { enum: ["remote", "hybrid", "onsite"] }),
    marketEligibility: text("market_eligibility", {
      enum: ["IN_CONFIRMED", "REMOTE_UNVERIFIED"],
    }).notNull(),

    employmentType: text("employment_type"),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryCurrency: text("salary_currency"),
    salaryPeriod: text("salary_period"),

    applyUrl: text("apply_url"),
    sourceUrl: text("source_url"),

    /** Source-stated facts (may be null — never fabricated). */
    sourcePostedAt: timestamp("source_posted_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),

    /** Sifarish observations. */
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),

    status: text("status", { enum: ["ACTIVE", "UNKNOWN", "REMOVED"] })
      .notNull()
      .default("ACTIVE"),
    contentHash: text("content_hash").notNull(),
    version: integer("version").notNull().default(1),

    search: tsvector("search").generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`to_tsvector('english', coalesce(title,'') || ' ' || coalesce(normalized_title,'') || ' ' || coalesce(description_text,''))`,
    ),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("jobs_company_provider_external_uq").on(
      t.companyId,
      t.sourceProvider,
      t.externalId,
    ),
    index("jobs_status_idx").on(t.status),
    index("jobs_first_seen_idx").on(t.firstSeenAt),
    index("jobs_search_idx").using("gin", t.search),
  ],
);

export const jobSources = pgTable(
  "job_sources",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url"),
    isPrimary: boolean("is_primary").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("job_sources_uq").on(t.provider, t.externalId, t.jobId)],
);

export const jobVersions = pgTable(
  "job_versions",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentHash: text("content_hash").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("job_versions_uq").on(t.jobId, t.version)],
);

export const refreshRuns = pgTable("refresh_runs", {
  id: id(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status", { enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED"] })
    .notNull()
    .default("PENDING"),
  trigger: text("trigger", { enum: ["cron", "recovery", "manual"] })
    .notNull()
    .default("cron"),
  companiesTotal: integer("companies_total").notNull().default(0),
  companiesProcessed: integer("companies_processed").notNull().default(0),
  jobsNew: integer("jobs_new").notNull().default(0),
  jobsUpdated: integer("jobs_updated").notNull().default(0),
  jobsRemoved: integer("jobs_removed").notNull().default(0),
  jobsRejectedMarket: integer("jobs_rejected_market").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  createdAt: createdAt(),
});

export const crawlErrors = pgTable(
  "crawl_errors",
  {
    id: id(),
    runId: uuid("run_id").references(() => refreshRuns.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider"),
    stage: text("stage").notNull(),
    error: text("error").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("crawl_errors_company_idx").on(t.companyId)],
);

export const userJobEvents = pgTable(
  "user_job_events",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["IMPRESSION", "OPEN", "SAVE", "UNSAVE", "HIDE", "APPLY", "CONTACT"],
    }).notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("user_job_events_user_idx").on(t.userId, t.type)],
);
