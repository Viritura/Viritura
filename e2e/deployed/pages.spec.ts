import { expect, test } from "@playwright/test";

const WEBSITE_URL = process.env.VIRITURA_WEBSITE_URL ?? "https://viritura.com";

test("website homepage is available", async ({ page }) => {
  const response = await page.goto(WEBSITE_URL);
  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole("heading", { level: 1, name: "One score, from first note to final handoff." }),
  ).toBeVisible();
});

test("website documentation is available", async ({ page }) => {
  const response = await page.goto(`${WEBSITE_URL}/docs`);
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/Viritura/);
  await expect(page.getByRole("navigation", { name: "Documentation" }).first()).toBeVisible();
});
