import {
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
import { companies, jobs } from "./jobs.ts";
import { contacts, outreachMessages } from "./outreach.ts";

/**
 * Campaigns (AUTOPILOT-PLAN A4): approve a batch once, the worker sends one
 * message at a time inside caps and spacing, with follow-ups that stop on
 * reply or bounce. Every message is still an outreach_messages row.
 */

export interface CampaignStep {
  /** days after the previous step (step 0 is always day 0) */
  day: number;
  templateId: string;
}

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    steps: jsonb("steps").$type<CampaignStep[]>().notNull(),
    status: text("status", { enum: ["DRAFT", "RUNNING", "PAUSED", "DONE", "CANCELLED"] })
      .notNull()
      .default("DRAFT"),
    dailyCap: integer("daily_cap").notNull().default(40),
    spacingSec: integer("spacing_sec").notNull().default(120),
    pauseReason: text("pause_reason"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaigns_user_idx").on(t.userId, t.status)],
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** index of the NEXT step to send */
    step: integer("step").notNull().default(0),
    state: text("state", {
      enum: ["QUEUED", "WAITING", "DONE", "SKIPPED", "BOUNCED", "REPLIED", "FAILED", "STOPPED"],
    })
      .notNull()
      .default("QUEUED"),
    /** when the next step becomes due (null = now) */
    nextAt: timestamp("next_at", { withTimezone: true }),
    /** first message in the thread; later steps reply to it */
    rootMessageId: uuid("root_message_id").references(() => outreachMessages.id, {
      onDelete: "set null",
    }),
    lastMessageId: uuid("last_message_id").references(() => outreachMessages.id, {
      onDelete: "set null",
    }),
    skipReason: text("skip_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("campaign_recipients_uq").on(t.campaignId, t.contactId),
    index("campaign_recipients_due_idx").on(t.userId, t.state, t.nextAt),
  ],
);

/** Company-owned pages ContactDiscovery may read (team, about, leadership). Admin-curated. */
export const companyPages = pgTable(
  "company_pages",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["team", "about", "leadership", "other"] })
      .notNull()
      .default("team"),
    url: text("url").notNull(),
    lastDiscoveredAt: timestamp("last_discovered_at", { withTimezone: true }),
    lastFound: integer("last_found"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("company_pages_uq").on(t.companyId, t.url)],
);
