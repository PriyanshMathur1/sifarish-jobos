import { boolean, customType, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./helpers.ts";
import { users } from "./auth.ts";

/**
 * Slim candidate profile (grill G3): what search filters and outreach
 * template variables need. Extends when the matching engine arrives.
 */
export const profiles = pgTable("profiles", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  headline: text("headline"),
  currentTitle: text("current_title"),
  yearsExperience: integer("years_experience"),
  /** canonical skill names, ordered by self-declared strength */
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  functions: jsonb("functions").$type<string[]>().notNull().default([]),
  industries: jsonb("industries").$type<string[]>().notNull().default([]),
  locations: jsonb("locations").$type<string[]>().notNull().default([]),
  summarySource: text("summary_source", { enum: ["resume", "manual"] })
    .notNull()
    .default("manual"),

  /** Application details (Autopilot A2): what hosted forms ask for, stored once. */
  phone: text("phone"),
  linkedinUrl: text("linkedin_url"),
  portfolioUrl: text("portfolio_url"),
  currentLocation: text("current_location"),
  noticePeriodDays: integer("notice_period_days"),
  /** lakhs per annum, whole numbers are enough for forms */
  currentCtcLpa: integer("current_ctc_lpa"),
  expectedCtcLpa: integer("expected_ctc_lpa"),
  workAuthorization: text("work_authorization"),
  willingToRelocate: boolean("willing_to_relocate"),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Resumes live in Postgres (bytea, 5 MB cap enforced at upload): one user,
 * a handful of variants, no blob store to provision. The apply runner
 * fetches the default (or a per-job pick) through an owner-scoped route.
 */
export const resumes = pgTable(
  "resumes",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    content: bytea("content").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("resumes_user_label_uq").on(t.userId, t.label)],
);

/**
 * Answer bank: saved answers to the questions application forms ask
 * ("notice period?", "why us?"). questionKey is a normalized slug of the
 * question text so the runner can look up by what it sees on the page.
 */
export const answerBank = pgTable(
  "answer_bank",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    questionText: text("question_text").notNull(),
    answer: text("answer").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("answer_bank_user_key_uq").on(t.userId, t.questionKey)],
);

export type PreferenceStrictness = Record<string, "required" | "preferred">;

export const candidatePreferences = pgTable("candidate_preferences", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  targetRoles: jsonb("target_roles").$type<string[]>().notNull().default([]),
  targetFunctions: jsonb("target_functions").$type<string[]>().notNull().default([]),
  locations: jsonb("locations").$type<string[]>().notNull().default([]),
  remotePref: text("remote_pref", { enum: ["remote", "hybrid", "office", "any"] })
    .notNull()
    .default("any"),
  employmentTypes: jsonb("employment_types").$type<string[]>().notNull().default([]),
  industriesPreferred: jsonb("industries_preferred").$type<string[]>().notNull().default([]),
  industriesExcluded: jsonb("industries_excluded").$type<string[]>().notNull().default([]),
  excludedCompanies: jsonb("excluded_companies").$type<string[]>().notNull().default([]),
  /** field name → required|preferred (PRD §15) */
  strictness: jsonb("strictness").$type<PreferenceStrictness>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
