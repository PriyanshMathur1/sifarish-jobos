import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { z } from "zod";
import { SifarishClient, type Attempt, type Bundle, type Report } from "./client.ts";
import { adapterFor } from "./adapters/index.ts";
import { detectBlockers, fillForm } from "./fill.ts";

loadDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

/**
 * The apply runner (AUTOPILOT-PLAN Phase C). Runs on YOUR computer, in a
 * visible browser, with your identity. Pulls the queue Sifarish built from
 * your rules, fills each hosted form, and either waits for your click
 * (confirm) or submits (hands-off). Hard stops: CAPTCHA, login wall, an
 * unknown required question, an unsupported form. Every outcome is reported
 * back with a screenshot when something was submitted.
 */

const env = z
  .object({
    SIFARISH_URL: z.string().url(),
    SIFARISH_DEVICE_TOKEN: z.string().min(10),
    RUNNER_HEADLESS: z.enum(["true", "false"]).default("false"),
    RUNNER_CONFIRM_TIMEOUT_MIN: z.coerce.number().int().min(1).max(60).default(10),
    RUNNER_BATCH: z.coerce.number().int().min(1).max(20).default(5),
    RUNNER_MODE: z.enum(["confirm", "handsoff"]).optional(),
    RUNNER_EMAIL: z.string().email().optional(),
  })
  .parse(process.env);

// A CLI for a person: stdout is the interface, so the no-console rule is off here.
/* eslint-disable no-console */
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`, Object.keys(extra).length ? extra : "");

async function banner(page: Page, text: string): Promise<void> {
  await page
    .evaluate((t) => {
      const id = "sifarish-banner";
      document.getElementById(id)?.remove();
      const el = document.createElement("div");
      el.id = id;
      el.textContent = t;
      Object.assign(el.style, {
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        zIndex: "2147483647",
        background: "#16161d",
        color: "#fafaf7",
        font: "600 14px/1.4 system-ui, sans-serif",
        padding: "10px 16px",
        textAlign: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,.25)",
      });
      document.body.appendChild(el);
    }, text)
    .catch(() => {});
}

async function shot(page: Page): Promise<string | null> {
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 55, fullPage: false });
    return buf.byteLength < 600_000 ? buf.toString("base64") : null;
  } catch {
    return null;
  }
}

async function waitForSubmitted(page: Page, check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (page.isClosed()) return false;
    if (await check().catch(() => false)) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

async function runOne(page: Page, client: SifarishClient, bundle: Bundle, attempt: Attempt, resumePath: string | null, email: string): Promise<Report> {
  const url = attempt.formUrl;
  if (!url) return { status: "BLOCKED", blocker: "unsupported", error: "no apply URL" };
  const adapter = adapterFor(url);
  if (!adapter) return { status: "BLOCKED", blocker: "unsupported", formUrl: url, error: `no adapter for ${new URL(url).hostname}` };
  if (!resumePath) return { status: "BLOCKED", blocker: "no_resume", formUrl: url };
  if (!bundle.profile) return { status: "BLOCKED", blocker: "unknown_question", formUrl: url, questions: ["Fill in your profile basics first"] };
  const mode = env.RUNNER_MODE ?? attempt.mode;

  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
  if (!res || res.status() === 404 || res.status() === 410) return { status: "BLOCKED", blocker: "removed", formUrl: url };
  await page.waitForTimeout(1200);

  const early = await detectBlockers(page);
  if (early) return { status: "BLOCKED", blocker: early, formUrl: page.url() };

  const form = await adapter.openForm(page);
  if (!form) return { status: "BLOCKED", blocker: "unsupported", formUrl: page.url(), error: "form not found on page" };

  const fill = await fillForm(page, form, { profile: bundle.profile, answers: bundle.answers, resumePath }, email);
  log(`filled ${fill.filled.length} fields`, { unknown: fill.unknownRequired, skipped: fill.skippedOptional.length });

  if (fill.unknownRequired.length > 0) {
    await banner(page, `Sifarish: ${fill.unknownRequired.length} question(s) need an answer in the app. This one is parked.`);
    return {
      status: "BLOCKED",
      blocker: "unknown_question",
      blockerQuestion: fill.unknownRequired[0]!,
      questions: fill.unknownRequired.slice(0, 20),
      formUrl: page.url(),
    };
  }
  if (!fill.resumeAttached) return { status: "BLOCKED", blocker: "unsupported", formUrl: page.url(), error: "could not attach the resume" };

  const blocker = await detectBlockers(page);
  if (blocker) return { status: "BLOCKED", blocker, formUrl: page.url() };

  if (mode === "confirm") {
    await banner(page, "Sifarish filled this form. Review it, then click Submit. Waiting for you.");
    const ok = await waitForSubmitted(page, () => adapter.isSubmitted(page), env.RUNNER_CONFIRM_TIMEOUT_MIN * 60_000);
    if (!ok) return { status: "BLOCKED", blocker: "timeout", formUrl: page.url() };
    return { status: "SUBMITTED", formUrl: page.url(), screenshot: await shot(page) };
  }

  // hands-off
  const submit = adapter.submit(page);
  if (!(await submit.isVisible().catch(() => false))) return { status: "BLOCKED", blocker: "unsupported", formUrl: page.url(), error: "submit button not found" };
  await submit.click();
  const ok = await waitForSubmitted(page, () => adapter.isSubmitted(page), 60_000);
  if (!ok) {
    const late = await detectBlockers(page);
    if (late) return { status: "BLOCKED", blocker: late, formUrl: page.url() };
    // Validation errors on the page mean a field we filled was rejected.
    const errText = await page.locator("[class*='error' i], [role=alert]").allInnerTexts().catch(() => []);
    return { status: "FAILED", blocker: "error", formUrl: page.url(), error: (errText.join(" | ") || "no confirmation after submit").slice(0, 1500) };
  }
  return { status: "SUBMITTED", formUrl: page.url(), screenshot: await shot(page) };
}

async function main() {
  const client = new SifarishClient(env.SIFARISH_URL, env.SIFARISH_DEVICE_TOKEN);
  const bundle = await client.queue(env.RUNNER_BATCH);
  log(`runner "${bundle.runner}": ${bundle.attempts.length} queued, ${bundle.rules.submittedToday}/${bundle.rules.dailyCap} submitted today`);
  if (bundle.attempts.length === 0) return;

  const email = env.RUNNER_EMAIL ?? bundle.email ?? (await promptEmail());
  let resumePath: string | null = null;
  if (bundle.resume) {
    const dir = await mkdtemp(join(tmpdir(), "sifarish-"));
    resumePath = join(dir, bundle.resume.fileName.replace(/[^\w.-]+/g, "_") || "resume.pdf");
    await writeFile(resumePath, await client.resume(bundle.resume.id));
  }

  const browser = await chromium.launch({ headless: env.RUNNER_HEADLESS === "true" });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  try {
    for (const attempt of bundle.attempts) {
      if (!(await client.claim(attempt.id))) {
        log(`skip ${attempt.jobTitle}: already claimed`);
        continue;
      }
      const page = await context.newPage();
      log(`→ ${attempt.jobTitle} at ${attempt.companyName} (${attempt.provider}, ${env.RUNNER_MODE ?? attempt.mode})`);
      let report: Report;
      try {
        report = await runOne(page, client, bundle, attempt, resumePath, email);
      } catch (e) {
        report = { status: "FAILED", blocker: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 1500) };
      }
      await client.report(attempt.id, report);
      log(`  ${report.status}${report.blocker ? ` (${report.blocker})` : ""}`);
      if (report.status !== "SUBMITTED" && env.RUNNER_HEADLESS !== "true" && report.blocker === "unknown_question") {
        // leave the tab open so the user can see what was asked
      } else {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function promptEmail(): Promise<string> {
  // The account email is not part of the bundle by design; ask once and cache in .env.
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("Email to use on applications (set RUNNER_EMAIL in .env to skip): ")).trim();
  rl.close();
  return z.string().email().parse(answer);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
