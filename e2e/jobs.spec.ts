import { test, expect } from "@playwright/test";
import { signInAs, deleteUser } from "./helpers";

const EMAIL = "e2e-jobs@sifarish.local";

test.afterAll(async () => {
  await deleteUser(EMAIL);
});

test("seeded jobs are searchable with filters and honest badges (ticket 1.12)", async ({
  context,
  page,
}) => {
  await signInAs(context, EMAIL);

  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  // Seed data renders
  await expect(page.getByText("Senior Product Manager - Payments")).toBeVisible();

  // Text search hits title tokens
  await page.getByLabel("Search jobs").fill("product manager");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=product\+manager/, { timeout: 20000 });
  await expect(page.getByText("Senior Product Manager - Payments")).toBeVisible({ timeout: 20000 });
  // URL updates before the RSC payload commits — wait for the swap, not just the URL.
  await expect(page.getByText("Brand Marketing Manager")).toHaveCount(0, { timeout: 20000 });

  // Remote filter + unverified badge
  await page.goto("/jobs?remote=remote");
  await expect(page.getByText("Growth Analyst")).toBeVisible();
  await expect(page.getByText("Remote — eligibility unverified").first()).toBeVisible();
});

test("job detail shows source attribution, freshness, and apply-out (ticket 1.12)", async ({
  context,
  page,
}) => {
  await signInAs(context, EMAIL);
  await page.goto("/jobs?q=Payments");
  await page.getByRole("link", { name: "Senior Product Manager - Payments" }).click();

  await expect(
    page.getByRole("heading", { name: "Senior Product Manager - Payments" }),
  ).toBeVisible({
    timeout: 20000, // dev-server first compile of the detail route
  });
  await expect(page.getByText(/Posted |Discovered /).first()).toBeVisible();
  await expect(page.getByText(/Source: seed/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Apply at source/ })).toBeVisible();

  // Save from detail; verify Saved-only filter picks it up
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.goto("/jobs?saved=true");
  await expect(page.getByText("Senior Product Manager - Payments")).toBeVisible();
});

test("hide removes a job from the default list (ticket 1.12)", async ({ context, page }) => {
  await signInAs(context, EMAIL);
  await page.goto("/jobs?q=Brand");
  await expect(page.getByText("Brand Marketing Manager")).toBeVisible();
  await page.getByRole("button", { name: "Hide job" }).first().click();
  await page.goto("/jobs?q=Brand");
  await expect(page.getByText("Brand Marketing Manager")).toHaveCount(0);
});
