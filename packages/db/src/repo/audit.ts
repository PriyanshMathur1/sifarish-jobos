import type { Db } from "../client.ts";
import { auditLogs } from "../schema/index.ts";

export async function audit(
  db: Db,
  entry: {
    actorId: string | null;
    action: string;
    subjectType: string;
    subjectId?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId ?? null,
    meta: entry.meta ?? {},
  });
}
