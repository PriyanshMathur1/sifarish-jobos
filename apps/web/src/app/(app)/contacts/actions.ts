"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getDb, contactsRepo, schema, audit } from "@sifarish/db";
import {
  EmailValidator,
  emailHash,
  learnPattern,
  loadConfig,
  discoverContacts,
  SafeFetcher,
  HunterClient,
  parseName,
  logger,
} from "@sifarish/core";
import { ilike, sql } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { parseCsv } from "@/lib/csv";

const contactInput = z.object({
  fullName: z.string().trim().min(2).max(200),
  title: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
  email: z.string().email().max(320).optional().or(z.literal("")),
  url: z.string().url().max(500).optional().or(z.literal("")),
});

async function companyIdByName(name: string | undefined): Promise<string | null> {
  if (!name) return null;
  const db = getDb();
  const [c] = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(ilike(schema.companies.name, name))
    .limit(1);
  return c?.id ?? null;
}

export async function addContact(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const parsed = contactInput.parse({
    fullName: formData.get("fullName"),
    title: formData.get("title") || undefined,
    companyName: formData.get("companyName") || undefined,
    email: formData.get("email") || "",
    url: formData.get("url") || "",
  });

  const db = getDb();
  const companyId = await companyIdByName(parsed.companyName);
  const email = parsed.email || null;

  let emailStatus: "VERIFIED" | "UNKNOWN" | "INVALID" = "UNKNOWN";
  if (email) {
    // User-supplied = observed origin; still validated (PRD §72).
    const v = await new EmailValidator().validate(email, { origin: "observed" });
    emailStatus =
      v.status === "VERIFIED" ? "VERIFIED" : v.status === "INVALID" ? "INVALID" : "UNKNOWN";
    // A verified observation teaches the company pattern (PRD §71).
    if (v.status === "VERIFIED" && companyId) {
      const pattern = learnPattern(parsed.fullName, email);
      if (pattern) {
        await contactsRepo.recordPatternEvidence(db, companyId, pattern, email.split("@")[1]!);
      }
    }
  }

  await contactsRepo.createContact(db, userId, {
    fullName: parsed.fullName,
    title: parsed.title ?? null,
    companyId,
    businessEmail: email,
    emailStatus,
    professionalUrls: parsed.url ? [parsed.url] : [],
    sourceType: "manual",
  });
  revalidatePath("/contacts");
}

export async function editContact(contactId: string, formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const id = z.string().uuid().parse(contactId);
  const parsed = contactInput.parse({
    fullName: formData.get("fullName"),
    title: formData.get("title") || undefined,
    companyName: formData.get("companyName") || undefined,
    email: formData.get("email") || "",
    url: formData.get("url") || "",
  });
  const db = getDb();
  const existing = await contactsRepo.getContact(db, userId, id);
  if (!existing) return;
  const companyId = await companyIdByName(parsed.companyName);
  const email = parsed.email || null;

  // Email unchanged keeps its status; a new address is re-validated as observed.
  let emailStatus = existing.contact.emailStatus;
  if (email !== existing.contact.businessEmail) {
    emailStatus = "UNKNOWN";
    if (email) {
      const v = await new EmailValidator().validate(email, { origin: "observed" });
      emailStatus = v.status === "VERIFIED" ? "VERIFIED" : v.status === "INVALID" ? "INVALID" : "UNKNOWN";
      if (v.status === "VERIFIED" && companyId) {
        const pattern = learnPattern(parsed.fullName, email);
        if (pattern) await contactsRepo.recordPatternEvidence(db, companyId, pattern, email.split("@")[1]!);
      }
    }
  }
  await contactsRepo.updateContact(db, userId, id, {
    fullName: parsed.fullName,
    title: parsed.title ?? null,
    companyId,
    businessEmail: email,
    emailStatus,
    professionalUrls: parsed.url ? [parsed.url] : existing.contact.professionalUrls,
  });
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/contacts");
}

/** Upload of the LinkedIn Connections.csv export. Only rows whose company Sifarish tracks, or with an email, are useful; the rest are imported name-only. */
export async function importLinkedInCsv(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  if (!rateLimit(`import:${userId}`, { ratePerMinute: 3 }).allowed) return;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024) return;
  const onlyTracked = formData.get("onlyTracked") === "on";

  const text = Buffer.from(await file.arrayBuffer()).toString("utf8");
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => r.some((c) => /^first name$/i.test(c.trim())));
  if (headerIdx < 0) return;
  const header = rows[headerIdx]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iFirst = col("first name");
  const iLast = col("last name");
  const iUrl = col("url");
  const iEmail = col("email address");
  const iCompany = col("company");
  const iPos = col("position");

  const db = getDb();
  const validator = new EmailValidator();
  let imported = 0;
  for (const r of rows.slice(headerIdx + 1)) {
    if (imported >= 1000) break;
    const fullName = `${r[iFirst] ?? ""} ${r[iLast] ?? ""}`.trim();
    if (fullName.length < 2) continue;
    const companyName = (r[iCompany] ?? "").trim();
    const companyId = await companyIdByName(companyName || undefined);
    if (onlyTracked && !companyId) continue;
    const rawEmail = (r[iEmail] ?? "").trim();
    const validEmail = rawEmail && z.string().email().safeParse(rawEmail).success ? rawEmail : null;
    let emailStatus: "VERIFIED" | "UNKNOWN" | "INVALID" = "UNKNOWN";
    if (validEmail) {
      const v = await validator.validate(validEmail, { origin: "observed" });
      emailStatus = v.status === "VERIFIED" ? "VERIFIED" : v.status === "INVALID" ? "INVALID" : "UNKNOWN";
    }
    const url = (r[iUrl] ?? "").trim();
    await contactsRepo.createContact(db, userId, {
      fullName,
      title: (r[iPos] ?? "").trim() || null,
      companyId,
      businessEmail: validEmail,
      emailStatus,
      professionalUrls: url ? [url] : [],
      sourceType: "manual",
    });
    imported += 1;
  }
  await audit(db, { actorId: userId, action: "contacts.import.linkedin_csv", subjectType: "contact", meta: { imported } });
  revalidatePath("/contacts");
}

/** Paste import: one contact per line — "Name, Title, Company[, email]". */
export async function importContacts(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  if (!rateLimit(`import:${userId}`, { ratePerMinute: 5 }).allowed) return;
  const text = z
    .string()
    .max(20000)
    .parse(formData.get("bulk") ?? "");
  const db = getDb();
  const validator = new EmailValidator(); // MX results cached per domain
  for (const line of text.split("\n")) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 1 || !parts[0]) continue;
    const [fullName, title, companyName, email] = parts;
    if (fullName.length < 2) continue;
    const companyId = await companyIdByName(companyName);
    const validEmail = email && z.string().email().safeParse(email).success ? email : null;
    let emailStatus: "VERIFIED" | "UNKNOWN" | "INVALID" = "UNKNOWN";
    if (validEmail) {
      const v = await validator.validate(validEmail, { origin: "observed" });
      emailStatus =
        v.status === "VERIFIED" ? "VERIFIED" : v.status === "INVALID" ? "INVALID" : "UNKNOWN";
      if (v.status === "VERIFIED" && companyId) {
        const pattern = learnPattern(fullName, validEmail);
        if (pattern) {
          await contactsRepo.recordPatternEvidence(
            db,
            companyId,
            pattern,
            validEmail.split("@")[1]!,
          );
        }
      }
    }
    await contactsRepo.createContact(db, userId, {
      fullName,
      title: title || null,
      companyId,
      businessEmail: validEmail,
      emailStatus,
      sourceType: "manual",
    });
  }
  revalidatePath("/contacts");
}

export async function chooseSuggestedEmail(
  contactId: string,
  email: string,
  status: string,
): Promise<void> {
  const { userId } = await requireUser();
  const db = getDb();
  const parsedStatus = z.enum(["HIGH_CONFIDENCE", "PROBABLE", "UNKNOWN"]).parse(status);
  await contactsRepo.updateContactEmail(
    db,
    userId,
    z.string().uuid().parse(contactId),
    z.string().email().parse(email),
    parsedStatus,
  );
  revalidatePath(`/contacts/${contactId}`);
}

export async function suppressContactAction(contactId: string): Promise<void> {
  const { userId } = await requireUser();
  const db = getDb();
  const id = z.string().uuid().parse(contactId);
  const row = await contactsRepo.getContact(db, userId, id);
  await contactsRepo.suppressContact(
    db,
    userId,
    id,
    row?.contact.businessEmail ? emailHash(row.contact.businessEmail) : null,
  );
  await audit(db, {
    actorId: userId,
    action: "contact.suppress",
    subjectType: "contact",
    subjectId: id,
  });
  revalidatePath("/contacts");
}

/**
 * Best-effort discovery from a company-owned public page (PRD §66–69,
 * behind CONTACT_DISCOVERY). JSON-LD Person only; robots honoured inside
 * discoverContacts; suppressed addresses are never re-created (PRD §75).
 */
export async function discoverFromPage(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const config = loadConfig();
  if (!config.CONTACT_DISCOVERY) return;
  if (!rateLimit(`discover:${userId}`, { ratePerMinute: 3 }).allowed) return;

  const url = z.string().url().max(500).parse(formData.get("url"));
  const companyName = z
    .string()
    .max(200)
    .optional()
    .parse(formData.get("companyName") || undefined);
  const companyId = await companyIdByName(companyName);

  const db = getDb();
  const result = await discoverContacts(new SafeFetcher(), url);
  if (!result.ok) return; // page unreachable/blocked — nothing to add
  for (const person of result.value) {
    if (person.email) {
      const [suppressed] = await db
        .select({ id: schema.contactSuppressions.id })
        .from(schema.contactSuppressions)
        .where(sql`${schema.contactSuppressions.emailHash} = ${emailHash(person.email)}`);
      if (suppressed) continue;
    }
    await contactsRepo.createContact(db, userId, {
      fullName: person.fullName,
      title: person.title,
      companyId,
      businessEmail: person.email,
      emailStatus: person.email ? "VERIFIED" : "UNKNOWN", // page-published = observed
      professionalUrls: person.url ? [person.url] : [],
      sourceType: "discovered",
      sourceUrl: person.sourceUrl,
    });
  }
  revalidatePath("/contacts");
}

/**
 * One-contact-at-a-time Hunter.io lookup — free tier, single credit per
 * click. Best-effort: any failure (no key configured, quota exhausted,
 * network error) is a silent no-op, matching discoverFromPage's convention.
 * Results are third-party inference, never VERIFIED (see hunter.ts).
 */
export async function lookupEmailViaHunter(contactId: string): Promise<void> {
  const { userId } = await requireUser();
  const config = loadConfig();
  if (!config.HUNTER_API_KEY) return;
  if (!rateLimit(`hunter:${userId}`, { ratePerMinute: 3 }).allowed) return;

  const id = z.string().uuid().parse(contactId);
  const db = getDb();
  const row = await contactsRepo.getContact(db, userId, id);
  if (!row || row.contact.businessEmail || !row.companyDomain) return;

  const { first, last } = parseName(row.contact.fullName);
  if (!first || !last) return;

  const hunter = new HunterClient(config.HUNTER_API_KEY);
  const outcome = await hunter.findEmail({ domain: row.companyDomain, firstName: first, lastName: last });

  if (outcome.kind === "found") {
    await contactsRepo.updateContactEmail(db, userId, id, outcome.email, outcome.status);
    revalidatePath(`/contacts/${id}`);
    return;
  }
  if (outcome.kind === "error" || outcome.kind === "quota_exceeded") {
    logger.warn({ contactId: id, outcome }, "hunter lookup did not complete");
  }
  // not_found / invalid: nothing to save, page just keeps showing pattern-engine suggestions.
}
