import { test, expect } from "@playwright/test";
import { signInAs, deleteUser } from "./helpers";

/**
 * Phase 2 critical path (SPEC §6 E2E): contact → suggested email →
 * template preview → approved Gmail draft (fake adapter) → tracker.
 * Requires the dev server to run with GMAIL_TEST_FAKE=true (playwright.config).
 */
const EMAIL = "e2e-outreach@jobos.local";

test.afterAll(async () => {
  await deleteUser(EMAIL);
});

test("outreach critical path: contact → suggestion → preview → draft → tracker", async ({
  context,
  page,
}) => {
  await signInAs(context, EMAIL);

  // Profile powers template variables
  await page.goto("/profile");
  await page.getByLabel("Full name").fill("Priyansh Mathur");
  await page.getByLabel("Current / most recent title").fill("Product Manager");
  await page.getByLabel(/Skills/).fill("Growth, SQL, Experimentation");
  await page.getByRole("button", { name: "Save profile" }).click();

  // Add a contact at a tracked company (Razorpay has domain → suggestions)
  await page.goto("/contacts");
  await page.getByPlaceholder("Full name *").fill("Anita Desai");
  await page.getByPlaceholder("Title (e.g. Talent Partner)").fill("Talent Partner");
  await page.getByPlaceholder(/Company \(match/).fill("Razorpay");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("link", { name: "Anita Desai" })).toBeVisible();

  // Detail: pattern suggestions with honest confidence labels
  await page.getByRole("link", { name: "Anita Desai" }).click();
  await expect(page.getByText("anita.desai@razorpay.com")).toBeVisible();
  await page
    .locator("form", { hasText: "anita.desai@razorpay.com" })
    .getByRole("button", { name: "Use this" })
    .click();
  await expect(page.getByText("anita.desai@razorpay.com")).toBeVisible();

  // Compose against a seeded job with a recruiter-intro template
  await page.getByRole("link", { name: "Compose outreach →" }).click();
  await page
    .getByLabel("Job", { exact: false })
    .selectOption({ label: "Senior Product Manager - Payments — Razorpay" });
  await page.getByLabel("Template *").selectOption({ label: "Recruiter introduction (built-in)" });
  await page.getByRole("button", { name: "Preview" }).click();

  // Preview: variables resolved, fully editable
  await expect(page.getByRole("heading", { name: /Preview/ })).toBeVisible();
  const body = page.getByLabel("Body");
  await expect(body).toBeVisible();
  const text = await body.inputValue();
  expect(text).toContain("Hi Anita,");
  expect(text).toContain("Priyansh Mathur");
  expect(text).not.toContain("{{");

  // Approve as draft (fake Gmail in test mode)
  await page.getByRole("button", { name: "Create Gmail draft" }).click();
  await expect(page).toHaveURL(/\/outreach\?done=drafted/);
  await expect(page.getByText("Draft created in your Gmail")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Anita Desai/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "DRAFTED" })).toBeVisible();

  // The contacted job appears in the tracker as CONTACTED
  await page.goto("/tracker");
  const trackerCard = page.locator("article", { hasText: "Senior Product Manager - Payments" });
  await expect(trackerCard).toBeVisible();
  await expect(trackerCard.locator("select")).toHaveValue("CONTACTED");
});

test("mark applied stores a snapshot and tracker status updates", async ({ context, page }) => {
  await signInAs(context, EMAIL);
  await page.goto("/jobs?q=Integrations");
  await page.getByRole("link", { name: "Product Manager - Integrations" }).click();
  await page.getByRole("button", { name: "Mark applied" }).click();

  await page.goto("/tracker");
  const card = page.locator("article", { hasText: "Product Manager - Integrations" });
  await expect(card).toBeVisible();
  await expect(card.locator("select")).toHaveValue("APPLIED");

  await card.locator("select").selectOption("INTERVIEW");
  await card.getByRole("button", { name: "Update" }).click();
  await expect(
    page.locator("article", { hasText: "Product Manager - Integrations" }).locator("select"),
  ).toHaveValue("INTERVIEW");
});
