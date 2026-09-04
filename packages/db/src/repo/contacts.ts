import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { companies, contacts, companyEmailPatterns, contactSuppressions } from "../schema/index.ts";

/** Contacts repository — owner-scoped throughout (SPEC §3 choke point). */

export interface NewContact {
  fullName: string;
  title?: string | null;
  companyId?: string | null;
  businessEmail?: string | null;
  emailStatus?: "VERIFIED" | "HIGH_CONFIDENCE" | "PROBABLE" | "UNKNOWN" | "INVALID";
  professionalUrls?: string[];
  sourceType?: "manual" | "discovered";
  sourceUrl?: string | null;
}

export async function listContacts(db: Db, userId: string) {
  return db
    .select({
      id: contacts.id,
      fullName: contacts.fullName,
      title: contacts.title,
      businessEmail: contacts.businessEmail,
      emailStatus: contacts.emailStatus,
      sourceType: contacts.sourceType,
      companyName: companies.name,
      companyId: contacts.companyId,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .where(and(eq(contacts.userId, userId), isNull(contacts.suppressedAt)))
    .orderBy(desc(contacts.createdAt));
}

export async function getContact(db: Db, userId: string, contactId: string) {
  const [row] = await db
    .select({
      contact: contacts,
      companyName: companies.name,
      companyDomain: companies.domain,
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)));
  return row ?? null;
}

/**
 * Insert with dedup: an existing non-suppressed contact with the same email,
 * or the same name at the same company, is returned instead of duplicated.
 */
export async function createContact(db: Db, userId: string, input: NewContact) {
  const dupConds = [];
  if (input.businessEmail) {
    dupConds.push(
      and(eq(contacts.userId, userId), eq(contacts.businessEmail, input.businessEmail)),
    );
  }
  if (input.companyId) {
    dupConds.push(
      and(
        eq(contacts.userId, userId),
        eq(contacts.companyId, input.companyId),
        sql`lower(${contacts.fullName}) = lower(${input.fullName})`,
      ),
    );
  }
  for (const cond of dupConds) {
    const [existing] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(cond, isNull(contacts.suppressedAt)))
      .limit(1);
    if (existing) return existing;
  }
  const [row] = await db
    .insert(contacts)
    .values({
      userId,
      fullName: input.fullName,
      title: input.title ?? null,
      companyId: input.companyId ?? null,
      businessEmail: input.businessEmail ?? null,
      emailStatus: input.emailStatus ?? (input.businessEmail ? "VERIFIED" : "UNKNOWN"),
      professionalUrls: input.professionalUrls ?? [],
      sourceType: input.sourceType ?? "manual",
      sourceUrl: input.sourceUrl ?? null,
    })
    .returning({ id: contacts.id });
  return row!;
}

export async function updateContactEmail(
  db: Db,
  userId: string,
  contactId: string,
  email: string,
  status: "VERIFIED" | "HIGH_CONFIDENCE" | "PROBABLE" | "UNKNOWN" | "INVALID",
) {
  await db
    .update(contacts)
    .set({ businessEmail: email, emailStatus: status, lastVerifiedAt: new Date() })
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)));
}

export interface ContactEdit {
  fullName: string;
  title: string | null;
  companyId: string | null;
  businessEmail: string | null;
  emailStatus: "VERIFIED" | "HIGH_CONFIDENCE" | "PROBABLE" | "UNKNOWN" | "INVALID";
  professionalUrls: string[];
}

/** Edit the fields a person can reasonably correct by hand. Owner-scoped. */
export async function updateContact(db: Db, userId: string, contactId: string, input: ContactEdit) {
  await db
    .update(contacts)
    .set({ ...input })
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)));
}

/** Suppress: hide + prevent rediscovery/sending (PRD §75). */
export async function suppressContact(
  db: Db,
  userId: string,
  contactId: string,
  emailHashValue: string | null,
) {
  await db
    .update(contacts)
    .set({ suppressedAt: new Date() })
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)));
  if (emailHashValue) {
    await db
      .insert(contactSuppressions)
      .values({ emailHash: emailHashValue, reason: "user_suppressed" })
      .onConflictDoNothing();
  }
}

export async function getCompanyPatterns(db: Db, companyId: string) {
  return db
    .select()
    .from(companyEmailPatterns)
    .where(eq(companyEmailPatterns.companyId, companyId))
    .orderBy(desc(companyEmailPatterns.confidence));
}

/** Record a verified pattern observation — evidence accumulates (PRD §71). */
export async function recordPatternEvidence(
  db: Db,
  companyId: string,
  pattern: string,
  domain: string,
) {
  await db
    .insert(companyEmailPatterns)
    .values({
      companyId,
      pattern,
      domain,
      confidence: 0.6,
      evidenceCount: 1,
      lastVerifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [companyEmailPatterns.companyId, companyEmailPatterns.pattern],
      set: {
        evidenceCount: sql`${companyEmailPatterns.evidenceCount} + 1`,
        confidence: sql`least(0.95, ${companyEmailPatterns.confidence} + 0.1)`,
        lastVerifiedAt: new Date(),
      },
    });
}
