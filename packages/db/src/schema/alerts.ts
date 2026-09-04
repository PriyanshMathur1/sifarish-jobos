import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "./helpers.ts";
import { users } from "./auth.ts";
import { jobs } from "./jobs.ts";

/**
 * Alerts (Autopilot A6): how and when a user hears about matches.
 * Instant = one message per ticker tick listing new jobs at or above the
 * band; digest = one message a day at digest_hour (APP_TZ) covering the
 * last 24h. Both go through the Notifier seam.
 */
export const alertPreferences = pgTable("alert_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: ["email", "telegram", "none"] }).notNull().default("email"),
  instantEnabled: boolean("instant_enabled").notNull().default(true),
  instantMinBand: text("instant_min_band", { enum: ["strong", "good", "maybe"] })
    .notNull()
    .default("strong"),
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  digestMinBand: text("digest_min_band", { enum: ["strong", "good", "maybe"] })
    .notNull()
    .default("good"),
  /** local hour (APP_TZ) the digest goes out */
  digestHour: integer("digest_hour").notNull().default(9),
  telegramChatId: text("telegram_chat_id"),
  lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Every alert that went out, so instant alerts never repeat for a job. */
export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["instant", "digest"] }).notNull(),
    channel: text("channel").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("alerts_user_job_instant_uq").on(t.userId, t.jobId, t.kind),
    index("alerts_user_idx").on(t.userId, t.sentAt),
  ],
);
