import type { Locator, Page } from "playwright";
import type { FormAdapter } from "./types.ts";

/** Ashby hosted boards: jobs.ashbyhq.com/<company>/<id>, form at /application. */
export const ashby: FormAdapter = {
  id: "ashby",
  matches: (url) => /https?:\/\/jobs\.ashbyhq\.com\//i.test(url),
  async openForm(page: Page): Promise<Locator | null> {
    if (!/\/application/.test(page.url())) {
      const apply = page.getByRole("link", { name: /apply/i }).or(page.getByRole("button", { name: /apply/i })).first();
      if (await apply.isVisible().catch(() => false)) {
        await apply.click();
        await page.waitForLoadState("domcontentloaded");
      } else {
        await page.goto(page.url().replace(/\/?(\?.*)?$/, "/application"), { waitUntil: "domcontentloaded" });
      }
    }
    await page.waitForTimeout(1000);
    const form = page.locator("form").filter({ has: page.locator("input[type=file]") });
    if (await form.count()) return form.first();
    // Ashby renders the application without a <form> in some themes; fall back to the main region.
    const main = page.locator("main, [class*='application' i]").first();
    return (await main.count()) ? main : null;
  },
  submit: (page) => page.getByRole("button", { name: /submit application|submit/i }).first(),
  async isSubmitted(page) {
    const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    return /thanks for applying|thank you for applying|application submitted|we've received your application|application received/.test(text);
  },
};
