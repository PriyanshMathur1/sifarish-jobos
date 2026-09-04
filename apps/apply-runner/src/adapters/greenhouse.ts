import type { Locator, Page } from "playwright";
import type { FormAdapter } from "./types.ts";

/** Greenhouse hosted boards: boards.greenhouse.io/<board>/jobs/<id> and job-boards.greenhouse.io. */
export const greenhouse: FormAdapter = {
  id: "greenhouse",
  matches: (url) => /https?:\/\/(job-boards|boards)\.greenhouse\.io\//i.test(url) || /greenhouse\.io\/.*\/jobs\//i.test(url),
  async openForm(page: Page): Promise<Locator | null> {
    // Newer boards show the form inline; older ones behind an "Apply" button.
    const form = page.locator("form#application-form, form#application_form, form[action*='applications'], form").filter({ has: page.locator("input[type=file], input[name*='resume' i], #resume") });
    if (await form.count()) return form.first();
    const apply = page.getByRole("button", { name: /apply/i }).or(page.getByRole("link", { name: /apply/i })).first();
    if (await apply.isVisible().catch(() => false)) {
      await apply.click();
      await page.waitForTimeout(1500);
    }
    const again = page.locator("form").filter({ has: page.locator("input[type=file]") });
    return (await again.count()) ? again.first() : null;
  },
  submit: (page) => page.locator("button[type=submit], input[type=submit], #submit_app").filter({ hasText: /submit/i }).first().or(page.locator("button[type=submit], input[type=submit], #submit_app").first()),
  async isSubmitted(page) {
    const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    return /thank you for applying|application has been submitted|your application was submitted|application submitted|thanks for applying/.test(text) || /\/confirmation|applied=true/.test(page.url());
  },
};
