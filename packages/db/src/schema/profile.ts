import { integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
