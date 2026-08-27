import { test, expect } from "@playwright/test";
import { signInAs, deleteUser } from "./helpers";

const EMAIL = "e2e-shell@jobos.local";

test.afterAll(async () => {
  await deleteUser(EMAIL);
});

test("signed-in user can navigate every section (ticket 0.7)", async ({ context, page }) => {
  await signInAs(context, EMAIL);

  await page.goto("/jobs");
  await expect(page).toHaveURL(/\/jobs/);

  for (const section of ["Contacts", "Outreach", "Tracker", "Profile"]) {
    await page.getByRole("navigation", { name: "Primary" }).getByText(section).click();
    await expect(page).toHaveURL(new RegExp(`/${section.toLowerCase()}`));
  }

  // Non-admin never sees the Admin nav item
  await expect(page.getByRole("navigation", { name: "Primary" }).getByText("Admin")).toHaveCount(0);
});

test("profile edits persist and account deletion signs out (tickets 0.4, 0.7)", async ({
  context,
  page,
}) => {
  await signInAs(context, "e2e-delete@jobos.local");

  await page.goto("/profile");
  await page.getByLabel("Current / most recent title").fill("Growth PM");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.reload();
  await expect(page.getByLabel("Current / most recent title")).toHaveValue("Growth PM");

  await page.getByRole("button", { name: "Delete account and all data" }).click();
  await expect(page).toHaveURL(/\/signin/);

  // Session is dead: protected pages redirect
  await page.goto("/jobs");
  await expect(page).toHaveURL(/\/signin/);
});
