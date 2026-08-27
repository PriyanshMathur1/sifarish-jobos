import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, createdAt } from "./helpers.ts";
import { users } from "./auth.ts";

/** Append-only audit trail (PRD §107, §145). Never updated, never deleted. */
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});
