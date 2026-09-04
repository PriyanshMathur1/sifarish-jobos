import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./helpers.ts";
import { users } from "./auth.ts";
import { companies, jobs } from "./jobs.ts";

/**
 * Outreach core (SPEC §3, grill G3–G6): contacts with provenance,
 * email-pattern knowledge, Gmail account linkage, templates, per-message
 * outreach records, and the application CRM-lite.
 */

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    fullName: text("full_name").notNull(),
    title: text("title"),
    normalizedTitle: text("normalized_title"),
    department: text("department"),
    seniority: text("seniority"),
    professionalUrls: jsonb("professional_urls").$type<string[]>().notNull().default([]),
    businessEmail: text("business_email"),
    emailStatus: text("email_status", {
      enum: ["VERIFIED", "HIGH_CONFIDENCE", "PROBABLE", "UNKNOWN", "INVALID"],
    })
      .notNull()
      .default("UNKNOWN"),
    emailConfidence: real("email_confidence"),
    /** Provenance (PRD §154): where this contact was observed. */
    sourceUrl: text("source_url"),
    sourceType: text("source_type", { enum: ["manual", "discovered"] })
      .notNull()
      .default("manual"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_user_idx").on(t.userId), index("contacts_company_idx").on(t.companyId)],
);

export const contactSources = pgTable("contact_sources", {
  id: id(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  kind: text("kind").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companyEmailPatterns = pgTable(
  "company_email_patterns",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(), // e.g. "first.last", "flast", "first"
    domain: text("domain").notNull(),
    confidence: real("confidence").notNull().default(0.5),
    evidenceCount: integer("evidence_count").notNull().default(0),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.pattern] })],
);

/** Global suppression (PRD §75): a professional asked out — never re-shown,
 *  never re-discovered. Stored as an email hash + domain, not the person. */
export const contactSuppressions = pgTable("contact_suppressions", {
  id: id(),
  emailHash: text("email_hash").notNull().unique(),
  domain: text("domain"),
  reason: text("reason"),
  createdAt: createdAt(),
});

export const emailAccounts = pgTable("email_accounts", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["gmail"] })
    .notNull()
    .default("gmail"),
  email: text("email").notNull(),
  /** AES-256-GCM encrypted OAuth token bundle — never stored in plaintext. */
  oauthTokensEnc: text("oauth_tokens_enc").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const templates = pgTable("templates", {
  id: id(),
  /** null = built-in template visible to everyone. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", {
    enum: ["recruiter_intro", "hm_intro", "referral", "followup", "post_apply"],
  }).notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const outreachMessages = pgTable(
  "outreach_messages",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    mode: text("mode", { enum: ["draft", "send"] }).notNull(),
    status: text("status", {
      enum: ["PREPARED", "DRAFTED", "SENT", "REPLIED", "BOUNCED", "FAILED"],
    })
      .notNull()
      .default("PREPARED"),
    gmailDraftId: text("gmail_draft_id"),
    gmailThreadId: text("gmail_thread_id"),
    gmailMessageId: text("gmail_message_id"),
    /** RFC 5322 Message-ID we set on send, so follow-ups can thread (In-Reply-To). */
    rfcMessageId: text("rfc_message_id"),
    campaignId: uuid("campaign_id"),
    step: integer("step").notNull().default(0),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("outreach_user_idx").on(t.userId, t.status),
    index("outreach_campaign_idx").on(t.campaignId),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: [
        "INTERESTED",
        "SAVED",
        "APPLIED",
        "CONTACTED",
        "SCREENING",
        "INTERVIEW",
        "FINAL_ROUND",
        "OFFER",
        "REJECTED",
        "WITHDRAWN",
      ],
    })
      .notNull()
      .default("INTERESTED"),
    /** Immutable listing snapshot taken when the user applies (PRD §85). */
    jobSnapshot: jsonb("job_snapshot").$type<Record<string, unknown>>(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("applications_user_job_uq").on(t.userId, t.jobId)],
);

export const applicationEvents = pgTable("application_events", {
  id: id(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const notes = pgTable(
  "notes",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectType: text("subject_type", {
      enum: ["job", "company", "application", "contact"],
    }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("notes_subject_idx").on(t.userId, t.subjectType, t.subjectId)],
);

export const reminders = pgTable(
  "reminders",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectType: text("subject_type", {
      enum: ["job", "company", "application", "contact"],
    }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    message: text("message").notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("reminders_due_idx").on(t.userId, t.dueAt)],
);
