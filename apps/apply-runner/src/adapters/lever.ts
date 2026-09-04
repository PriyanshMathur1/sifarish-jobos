import type { Locator, Page } from "playwright";
import type { FormAdapter } from "./types.ts";

/** Lever hosted postings: jobs.lever.co/<company>/<id> with the form at /apply. */
export const lever: FormAdapter = {
  id: "lever",
  matches: (url) => /https?:\/\/jobs\.lever\.co\//i.test(url),
  async openForm(page: Page): Promise<Locator | null> {
    if (!/\/apply\/?(\?|$)/.test(page.url())) {
      const apply = page.locator("a.postings-btn, a[href$='/apply'], a:has-text('Apply for this job'), a:has-text('Apply')").first();
      if (await apply.isVisible().catch(() => false)) {
        await apply.click();
        await page.waitForLoadState("domcontentloaded");
      } else {
        await page.goto(page.url().replace(/\/?(\?.*)?$/, "/apply"), { waitUntil: "domcontentloaded" });
      }
    }
    const form = page.locator("form#application-form, form.application-form, form[action*='apply'], form").filter({ has: page.locator("input[name=resume], input[type=file]") });
    return (await form.count()) ? form.first() : null;
  },
  submit: (page) => page.locator("#btn-submit, button[type=submit]").first(),
  async isSubmitted(page) {
    if (/\/thanks/.test(page.url())) return true;
    const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    return /application has been received|thank you for applying|application submitted/.test(text);
  },
};
