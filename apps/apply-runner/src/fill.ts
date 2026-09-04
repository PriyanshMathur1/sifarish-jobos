import type { Frame, Locator, Page } from "playwright";
import type { Answer, Profile } from "./client.ts";

/**
 * Generic hosted-form filler. Discovers every field in the application form,
 * reads its label, maps the label to a profile field, a standard answer, or
 * an answer-bank entry, and fills it. Anything required that it cannot
 * answer is reported back as an unknown question; nothing is guessed.
 *
 * Per-provider adapters only supply selectors and quirks; this file is the
 * shared brain so a new ATS is a 40-line adapter, not a new filler.
 */

export interface FieldInfo {
  label: string;
  kind: "text" | "textarea" | "select" | "file" | "checkbox" | "radio" | "combobox" | "date" | "unknown";
  required: boolean;
  locator: Locator;
  /** for radio/checkbox groups and selects: the option labels */
  options: string[];
  name: string;
}

export interface FillContext {
  profile: Profile;
  answers: Answer[];
  resumePath: string | null;
}

export interface FillResult {
  filled: string[];
  skippedOptional: string[];
  unknownRequired: string[];
  resumeAttached: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[*:]+$/g, "").trim();

/** Same normalisation the server uses for answer_bank.question_key. */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(please|kindly|your|the|a|an|of|in|to|for|do|you|are|is|what|which|how)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-")
    .slice(0, 80);
}

type Resolved = { value: string } | { file: true } | { skip: true } | null;

function splitName(full: string | null): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1)! };
}

/** Map a label to a value from the profile. Order matters: specific before generic. */
export function resolveFromProfile(label: string, p: Profile): Resolved {
  const l = norm(label);
  const name = splitName(p.fullName);
  const rules: Array<[RegExp, () => Resolved]> = [
    [/\b(resume|cv|curriculum)\b/, () => ({ file: true })],
    [/cover letter/, () => null],
    [/\bfirst name\b|\bgiven name\b/, () => (name.first ? { value: name.first } : null)],
    [/\blast name\b|\bsurname\b|\bfamily name\b/, () => (name.last ? { value: name.last } : null)],
    [/\bfull name\b|^name$|\byour name\b|\bcandidate name\b/, () => (p.fullName ? { value: p.fullName } : null)],
    [/\be-?mail\b/, () => null], // email comes from the account; adapters fill it separately
    [/\bphone\b|\bmobile\b|\bcontact number\b/, () => (p.phone ? { value: p.phone } : null)],
    [/linkedin/, () => (p.linkedinUrl ? { value: p.linkedinUrl } : null)],
    [/portfolio|website|personal site|github|behance|dribbble/, () => (p.portfolioUrl ? { value: p.portfolioUrl } : { skip: true })],
    [/\bcurrent (company|employer|organi[sz]ation)\b|^company$|^organi[sz]ation$/, () => null],
    [/\bcurrent (title|role|designation|position)\b|\bjob title\b/, () => (p.currentTitle ? { value: p.currentTitle } : null)],
    [/notice period|\bnotice\b|joining time|how soon/, () => (p.noticePeriodDays != null ? { value: `${p.noticePeriodDays} days` } : null)],
    [/expected (ctc|salary|compensation|pay)|salary expectation|desired (salary|compensation)/, () => (p.expectedCtcLpa != null ? { value: `${p.expectedCtcLpa} LPA` } : null)],
    [/current (ctc|salary|compensation|pay)/, () => (p.currentCtcLpa != null ? { value: `${p.currentCtcLpa} LPA` } : null)],
    [/(years|yrs) of (total )?experience|total experience|\bexperience \(years\)/, () => (p.yearsExperience != null ? { value: String(p.yearsExperience) } : null)],
    [/relocat/, () => (p.willingToRelocate == null ? null : { value: p.willingToRelocate ? "Yes" : "No" })],
    [/authori[sz]ed to work|legally (able|eligible|authori[sz]ed)|work (authori[sz]ation|permit)|eligib(le|ility) to work|right to work|visa (status|sponsorship)|require.*sponsorship/, () => (p.workAuthorization ? { value: p.workAuthorization } : null)],
    [/\b(current )?(location|city)\b|where are you (based|located)|\bbased in\b/, () => (p.currentLocation ? { value: p.currentLocation } : null)],
    [/pronoun|gender|ethnicit|race|veteran|disabilit|sexual orientation|hispanic|latino/, () => ({ skip: true })],
    [/how did you hear|where did you (find|hear)|source/, () => null],
  ];
  for (const [re, fn] of rules) if (re.test(l)) return fn();
  return null;
}

export function resolveFromAnswers(label: string, answers: Answer[]): string | null {
  const key = questionKey(label);
  if (!key) return null;
  const exact = answers.find((a) => a.key === key);
  if (exact) return exact.answer;
  // Loose containment on the normalised key, so "notice period (days)" matches "notice period".
  const loose = answers.find((a) => a.key.length >= 6 && (key.includes(a.key) || a.key.includes(key)));
  return loose?.answer ?? null;
}

/** Pick the option whose text best matches an answer ("Yes"/"No", city names, etc.). */
export function bestOption(options: string[], answer: string): string | null {
  const a = norm(answer);
  if (!a) return null;
  const exact = options.find((o) => norm(o) === a);
  if (exact) return exact;
  const yes = /^(yes|y|true)$/.test(a);
  const no = /^(no|n|false)$/.test(a);
  if (yes) return options.find((o) => /^yes\b/i.test(o)) ?? null;
  if (no) return options.find((o) => /^no\b/i.test(o)) ?? null;
  const contains = options.find((o) => norm(o).includes(a) || a.includes(norm(o)));
  if (contains) return contains;
  // token overlap
  const at = new Set(a.split(/\W+/).filter((t) => t.length > 2));
  let best: { o: string; n: number } | null = null;
  for (const o of options) {
    const n = norm(o).split(/\W+/).filter((t) => at.has(t)).length;
    if (n > 0 && (!best || n > best.n)) best = { o, n };
  }
  return best?.o ?? null;
}

/** Label for a control: <label for>, aria-label, wrapping label, placeholder, or nearest heading text. */
async function labelFor(root: Frame | Page, el: Locator): Promise<string> {
  return el.evaluate((node) => {
    const e = node as HTMLElement;
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
    const id = e.getAttribute("id");
    if (id) {
      const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      const lab = document.querySelector(`label[for="${esc}"]`);
      if (lab && clean(lab.textContent)) return clean(lab.textContent);
    }
    const aria = e.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labelledBy = e.getAttribute("aria-labelledby");
    if (labelledBy) {
      const t = labelledBy
        .split(/\s+/)
        .map((i) => clean(document.getElementById(i)?.textContent))
        .filter(Boolean)
        .join(" ");
      if (t) return t;
    }
    const wrap = e.closest("label");
    if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
    // fieldset legend (radio/checkbox groups)
    const fs = e.closest("fieldset");
    const legend = fs?.querySelector("legend");
    if (legend && clean(legend.textContent)) return clean(legend.textContent);
    // common ATS wrappers: a preceding label-like element inside the same field container
    let cur: HTMLElement | null = e.parentElement;
    for (let depth = 0; cur && depth < 4; depth += 1, cur = cur.parentElement) {
      const cand = cur.querySelector("label, .application-label, .field-label, [class*='label' i], legend, h3, h4");
      if (cand && cand !== e && clean(cand.textContent) && clean(cand.textContent).length < 200) return clean(cand.textContent);
    }
    const ph = e.getAttribute("placeholder");
    if (ph) return clean(ph);
    return clean(e.getAttribute("name"));
  });
}

/** Label for a radio/checkbox GROUP: the legend or the container's heading, never an option's own label. */
async function groupLabelFor(el: Locator): Promise<string> {
  return el.evaluate((node) => {
    const e = node as HTMLElement;
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
    const fs = e.closest("fieldset");
    const legend = fs?.querySelector("legend");
    if (legend && clean(legend.textContent)) return clean(legend.textContent);
    const group = e.closest("[role=group], [role=radiogroup]");
    const aria = group?.getAttribute("aria-label") ?? group?.getAttribute("aria-labelledby");
    if (aria) {
      const byId = document.getElementById(aria);
      return clean(byId ? byId.textContent : aria);
    }
    const own = e.closest("label");
    let cur: HTMLElement | null = (own ?? e).parentElement;
    for (let depth = 0; cur && depth < 4; depth += 1, cur = cur.parentElement) {
      const cands = Array.from(cur.querySelectorAll("legend, h3, h4, .application-label, .field-label, [class*='label' i], label"));
      const cand = cands.find((c) => !c.querySelector("input") && !c.closest("label") && clean(c.textContent) && clean(c.textContent).length < 200);
      if (cand) return clean(cand.textContent);
    }
    return clean(e.getAttribute("name"));
  });
}

async function isRequired(el: Locator): Promise<boolean> {
  return el.evaluate((node) => {
    const e = node as HTMLInputElement;
    if (e.required || e.getAttribute("aria-required") === "true") return true;
    const wrap = e.closest("label, .field, [class*='field' i], [class*='question' i], div");
    const txt = (wrap?.textContent ?? "").slice(0, 300);
    return /\*|\brequired\b/i.test(txt);
  });
}

/** Enumerate fillable controls inside `scope`. Radio/checkbox groups collapse to one field. */
export async function discoverFields(root: Frame | Page, scope: Locator): Promise<FieldInfo[]> {
  const controls = scope.locator(
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]), textarea, select, [role=combobox]",
  );
  const n = await controls.count();
  const fields: FieldInfo[] = [];
  const seenGroups = new Set<string>();
  for (let i = 0; i < n; i += 1) {
    const el = controls.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    const type = ((await el.getAttribute("type")) ?? "").toLowerCase();
    const name = (await el.getAttribute("name")) ?? "";
    const role = (await el.getAttribute("role")) ?? "";
    let kind: FieldInfo["kind"] = "unknown";
    let options: string[] = [];
    if (tag === "textarea") kind = "textarea";
    else if (tag === "select") {
      kind = "select";
      options = await el.locator("option").allTextContents();
    } else if (role === "combobox" || type === "search") kind = "combobox";
    else if (type === "file") kind = "file";
    else if (type === "checkbox" || type === "radio") {
      const groupKey = `${type}:${name}`;
      if (name && seenGroups.has(groupKey)) continue;
      if (name) seenGroups.add(groupKey);
      kind = type === "checkbox" ? "checkbox" : "radio";
      const group = name ? scope.locator(`input[type=${type}][name="${name.replace(/"/g, '\\"')}"]`) : el;
      const count = await group.count();
      for (let j = 0; j < count; j += 1) options.push(await labelFor(root, group.nth(j)));
    } else if (type === "date") kind = "date";
    else kind = "text";

    // A lone checkbox is its own question ("I agree..."); a group is named by its legend.
    const isGroup = (kind === "radio" || kind === "checkbox") && options.length > 1;
    const label = isGroup ? await groupLabelFor(el) : await labelFor(root, el);
    const required = await isRequired(el);
    fields.push({ label, kind, required, locator: el, options, name });
  }
  return fields;
}

async function setSelect(el: Locator, options: string[], value: string): Promise<boolean> {
  const pick = bestOption(options, value);
  if (!pick) return false;
  await el.selectOption({ label: pick });
  return true;
}

async function setCombobox(el: Locator, value: string): Promise<boolean> {
  await el.click();
  await el.fill(value.slice(0, 60)).catch(() => {});
  const page = el.page();
  const option = page.locator("[role=option], [role=listbox] li, .select__option, [class*='option' i]").filter({ hasText: value.split(" ")[0] ?? value }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    return true;
  }
  await el.press("Enter").catch(() => {});
  return true;
}

async function setGroup(scope: Locator, field: FieldInfo, value: string): Promise<boolean> {
  const pick = bestOption(field.options, value);
  if (!pick) return false;
  const idx = field.options.indexOf(pick);
  const group = scope.locator(`input[type=${field.kind}][name="${field.name.replace(/"/g, '\\"')}"]`);
  await group.nth(idx).check({ force: true });
  return true;
}

/**
 * Fill every discovered field. Email is passed separately because it is the
 * account identity, not a profile field.
 */
export async function fillForm(root: Frame | Page, scope: Locator, ctx: FillContext, email: string): Promise<FillResult> {
  const fields = await discoverFields(root, scope);
  const result: FillResult = { filled: [], skippedOptional: [], unknownRequired: [], resumeAttached: false };

  for (const f of fields) {
    const l = norm(f.label);
    if (!l) continue;

    // Resume upload
    if (f.kind === "file") {
      if (/resume|cv|curriculum/.test(l) || !result.resumeAttached) {
        if (ctx.resumePath) {
          await f.locator.setInputFiles(ctx.resumePath);
          result.resumeAttached = true;
          result.filled.push(f.label);
        } else if (f.required) result.unknownRequired.push(f.label);
      } else result.skippedOptional.push(f.label);
      continue;
    }

    // Email
    if (/\be-?mail\b/.test(l) && !/confirm/.test(l) && f.kind === "text") {
      await f.locator.fill(email);
      result.filled.push(f.label);
      continue;
    }
    if (/confirm.*e-?mail|e-?mail.*confirm/.test(l) && f.kind === "text") {
      await f.locator.fill(email);
      result.filled.push(f.label);
      continue;
    }

    // Consent / acknowledgement checkboxes that gate submission
    if (f.kind === "checkbox" && f.options.length <= 1 && /agree|consent|acknowledge|privacy|terms|certify|confirm that/.test(l)) {
      if (f.required) {
        await f.locator.check({ force: true });
        result.filled.push(f.label);
      } else result.skippedOptional.push(f.label);
      continue;
    }

    const fromProfile = resolveFromProfile(f.label, ctx.profile);
    if (fromProfile && "skip" in fromProfile) {
      result.skippedOptional.push(f.label);
      continue;
    }
    // Candidate values in order: profile, answer bank, derived yes/no for choice fields.
    const candidates: string[] = [];
    if (fromProfile && "value" in fromProfile) candidates.push(fromProfile.value);
    const fromAnswers = resolveFromAnswers(f.label, ctx.answers);
    if (fromAnswers) candidates.push(fromAnswers);
    const isChoice = f.kind === "select" || f.kind === "radio" || f.kind === "checkbox" || f.kind === "combobox";
    if (isChoice && /authori[sz]ed|legally|eligib|right to work|work permit/.test(l) && ctx.profile.workAuthorization) {
      candidates.push(/\b(no|not|sponsor)\b/i.test(ctx.profile.workAuthorization) ? "No" : "Yes");
    }
    if (isChoice && /sponsorship/.test(l) && ctx.profile.workAuthorization) {
      candidates.push(/sponsor/i.test(ctx.profile.workAuthorization) ? "Yes" : "No");
    }

    if (candidates.length === 0) {
      if (f.required) result.unknownRequired.push(f.label);
      else result.skippedOptional.push(f.label);
      continue;
    }

    let ok = false;
    for (const value of candidates) {
      try {
        if (f.kind === "select") ok = await setSelect(f.locator, f.options, value);
        else if (f.kind === "combobox") ok = await setCombobox(f.locator, value);
        else if (f.kind === "radio" || f.kind === "checkbox") ok = await setGroup(scope, f, value);
        else if (f.kind === "date") ok = false;
        else {
          await f.locator.fill(value);
          ok = true;
        }
      } catch {
        ok = false;
      }
      if (ok) break;
    }
    if (ok) result.filled.push(f.label);
    else if (f.required) result.unknownRequired.push(f.label);
    else result.skippedOptional.push(f.label);
  }
  return result;
}

/** Signals that must stop the runner regardless of mode. */
export async function detectBlockers(page: Page): Promise<"captcha" | "login_wall" | null> {
  const captcha = page.locator("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .g-recaptcha, .h-captcha, iframe[src*='turnstile'], [data-sitekey]");
  if ((await captcha.count()) > 0 && (await captcha.first().isVisible().catch(() => false))) return "captcha";
  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (/verify (that )?you are (a )?human|are you a robot/.test(body)) return "captcha";
  const password = page.locator("input[type=password]");
  if ((await password.count()) > 0 && (await password.first().isVisible().catch(() => false)) && /sign in|log in|login|create (an )?account/.test(body)) return "login_wall";
  return null;
}
