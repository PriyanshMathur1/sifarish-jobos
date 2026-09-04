import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectBlockers, discoverFields, fillForm, questionKey, bestOption } from "./fill.ts";

const fixture = fileURLToPath(new URL("../fixtures/greenhouse-like.html", import.meta.url));
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? undefined;
// Needs a browser: skipped where none is installed (run `pnpm apply:setup` once).
const browserAvailable = existsSync(executablePath ?? chromium.executablePath());

let browser: Browser;
let page: Page;
let resumePath: string;

beforeAll(async () => {
  if (!browserAvailable) return;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  page = await browser.newPage();
  const dir = mkdtempSync(join(tmpdir(), "sifarish-test-"));
  resumePath = join(dir, "resume.pdf");
  writeFileSync(resumePath, "%PDF-1.4 test");
});
afterAll(async () => {
  await browser?.close();
});

const profile = {
  fullName: "Priyansh Mathur",
  currentTitle: "Product Manager",
  phone: "+91 98765 43210",
  linkedinUrl: "https://linkedin.com/in/priyansh",
  portfolioUrl: null,
  currentLocation: "Bengaluru",
  noticePeriodDays: 30,
  currentCtcLpa: 30,
  expectedCtcLpa: 40,
  workAuthorization: "Indian citizen",
  willingToRelocate: true,
  yearsExperience: 5,
};

describe("fill (pure)", () => {
  it("normalises questions like the server", () => {
    expect(questionKey("What is your notice period?")).toBe("notice-period");
    expect(bestOption(["Select...", "Yes", "No"], "Indian citizen")).toBeNull();
    expect(bestOption(["Yes", "No"], "yes")).toBe("Yes");
  });

});

describe.skipIf(!browserAvailable)("fill (browser)", () => {
  it("discovers labels, fills from profile + answers, and reports unknown required questions", async () => {
    await page.goto(`file://${fixture}`);
    const form = page.locator("form#application-form");
    const fields = await discoverFields(page, form);
    expect(fields.map((f) => f.label)).toEqual(
      expect.arrayContaining(["First Name *", "Resume/CV *", "Willing to relocate to Bengaluru? *", "I agree to the privacy policy *"]),
    );

    const result = await fillForm(page, form, {
      profile,
      answers: [
        { question: "Why do you want to work here?", key: "why-want-work-here", answer: "Because payments." },
        { question: "Are you legally authorised to work in India?", key: "legally-authorised-work-india", answer: "Yes" },
      ],
      resumePath,
    }, "priyansh@example.com");

    expect(await page.inputValue("#first_name")).toBe("Priyansh");
    expect(await page.inputValue("#last_name")).toBe("Mathur");
    expect(await page.inputValue("#email")).toBe("priyansh@example.com");
    expect(await page.inputValue("#phone")).toBe("+91 98765 43210");
    expect(await page.inputValue("#q1")).toBe("https://linkedin.com/in/priyansh");
    expect(await page.inputValue("#q2")).toBe("30 days");
    expect(await page.inputValue("#q3")).toBe("Yes");
    expect(await page.inputValue("#q4")).toBe("Because payments.");
    expect(await page.isChecked("input[name=reloc][value=y]")).toBe(true);
    expect(await page.isChecked("input[name=consent]")).toBe(true);
    expect(await page.inputValue("#gender")).toBe("Decline"); // untouched (EEO skipped)
    expect(result.resumeAttached).toBe(true);
    expect(await page.evaluate(() => (document.querySelector("#resume") as HTMLInputElement).files?.length)).toBe(1);

    expect(result.unknownRequired).toEqual(["Favourite payment rail and why? *"]);
    expect(result.skippedOptional).toContain("Gender (voluntary)");
    expect(await detectBlockers(page)).toBeNull();
  });

  it("flags CAPTCHA and login walls", async () => {
    await page.setContent(`<form><div class="g-recaptcha" data-sitekey="x">captcha</div></form>`);
    expect(await detectBlockers(page)).toBe("captcha");
    await page.setContent(`<h1>Sign in</h1><form><input type="password"></form>`);
    expect(await detectBlockers(page)).toBe("login_wall");
  });
});
