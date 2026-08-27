import { test, expect } from "@playwright/test";

test("health endpoint reports db up", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  expect(await res.json()).toMatchObject({ ok: true, db: "up" });
});

test("unauthenticated user is sent to sign-in", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole("heading", { name: "JobOS" })).toBeVisible();
});

test("cron endpoint rejects a bad secret", async ({ request }) => {
  const res = await request.post("/api/cron/refresh", {
    headers: { authorization: "Bearer wrong" },
  });
  expect(res.status()).toBe(401);
});
