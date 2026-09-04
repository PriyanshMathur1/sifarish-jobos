import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { jobs } from "./jobs.ts";

/**
 * Persisted MatchingEngine output, one row per (user, job). Recomputed when
 * a job is ingested/updated or the user's profile changes; reasons are the
 * exact sentences the engine produced, so the feed never re-derives them.
 */
export const jobMatches = pgTable(
  "job_matches",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    band: text("band", { enum: ["strong", "good", "maybe", "weak"] }).notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    gate: text("gate"),
    parts: jsonb("parts")
      .$type<{ title: number; skills: number; seniority: number; location: number; freshness: number }>()
      .notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.jobId] }),
    index("job_matches_user_score_idx").on(t.userId, t.score),
  ],
);
