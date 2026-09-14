import { expect, test, type Page, type Route } from "@playwright/test";

const TEST_API_PATTERNS = [
  "**/__test-api/auth/**",
  "http://api.*.localhost/auth/**",
  "https://api.viritura.com/auth/**",
];

async function mockGuestApi(page: Page): Promise<void> {
  const handleRoute = async (route: Route): Promise<void> => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/me")) {
      await route.fulfill({ json: { authenticated: false, user: null } });
      return;
    }
    if (url.pathname.endsWith("/auth/capabilities")) {
      await route.fulfill({
        json: {
          gitHubLoginEnabled: false,
          googleLoginEnabled: false,
          emailRegistrationMode: "Disabled",
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Unhandled test API request" } });
  };
  await Promise.all(TEST_API_PATTERNS.map((pattern) => page.route(pattern, handleRoute)));
}

async function openEditor(page: Page, path = "/"): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("viritura.startCenter.suppress", "1");
  });
  await mockGuestApi(page);
  await page.goto(path);
  await expect(page.locator('canvas[tabindex="0"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Laying out score")).toHaveCount(0, { timeout: 45_000 });
}

test("@smoke boots the editor and opens contextual help", async ({ page }) => {
  await openEditor(page);

  const canvas = page.locator('canvas[tabindex="0"]');
  const bounds = await canvas.boundingBox();
  expect(bounds?.width).toBeGreaterThan(0);
  expect(bounds?.height).toBeGreaterThan(0);

  await page.keyboard.press("F1");
  await expect(page.getByRole("dialog", { name: "Viritura — Help" })).toBeVisible();
});

test("@smoke edits and undoes the current document", async ({ page }) => {
  await openEditor(page);

  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("tab", { name: "Project" }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Playwright Edit");
  await title.press("Enter");
  await expect(title).toHaveValue("Playwright Edit");
  await expect(page).toHaveTitle(/ • — Viritura/);

  await page.getByRole("menuitem", { name: "Edit" }).click();
  const undo = page.getByRole("menuitem", { name: /^Undo/ });
  await expect(undo).toBeEnabled();
  await undo.click();
  await page.getByRole("button", { name: "Write" }).click();
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("tab", { name: "Project" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Symphony No. 5 - Opus 67");
});
