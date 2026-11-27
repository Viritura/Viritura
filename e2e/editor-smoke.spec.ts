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

test("keeps export format labels aligned when the selection changes", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const format = page.getByRole("combobox", { name: "Export format" });

  for (const selected of ["PDF", "WAV"]) {
    await format.click();
    const options = page.getByRole("option");
    await expect(options).toHaveText(["PDF", "MusicXML", "MNX", "MIDI", "MP3", "WAV"]);
    for (const name of ["MusicXML", "MNX", "MIDI"]) {
      await expect(page.getByRole("option", { name })).toHaveAttribute("aria-disabled", "true");
    }
    await expect(page.getByRole("option", { name: selected })).toHaveAttribute("data-state", "checked");
    await expect(options.filter({ has: page.locator("svg") })).toHaveCount(1);
    const offsets = await options.evaluateAll((elements) =>
      elements.map((option) => {
        const labelId = option.getAttribute("aria-labelledby");
        const label = labelId ? document.getElementById(labelId) : null;
        if (!label) throw new Error("Select option has no label");
        return label.getBoundingClientRect().left - option.getBoundingClientRect().left;
      }),
    );
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(1);
    if (selected === "PDF") await page.getByRole("option", { name: "WAV" }).click();
    else await page.keyboard.press("Escape");
  }

  await expect(page.getByRole("textbox", { name: "Filename pattern" })).toHaveValue("%TITLE% - %PART%");
  await page.getByRole("combobox", { name: "WAV bit depth" }).click();
  await expect(page.getByRole("option")).toHaveText(["16-bit", "24-bit", "32-bit float"]);
  await page.getByRole("option", { name: "16-bit" }).click();
  await expect(page.getByRole("combobox", { name: "WAV bit depth" })).toHaveText("16-bit");

  await format.click();
  await page.getByRole("option", { name: "MP3" }).click();
  await page.getByRole("combobox", { name: "MP3 bitrate" }).click();
  await expect(page.getByRole("option")).toHaveText(["128 kbps", "192 kbps", "256 kbps", "320 kbps"]);
  await page.getByRole("option", { name: "320 kbps" }).click();
  await expect(page.getByRole("combobox", { name: "MP3 bitrate" })).toHaveText("320 kbps");
});

test("keeps a select badge in place when its option is selected", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByRole("tab", { name: "Instruments" }).click();
  await page.getByRole("button", { name: "Trumpet in C 1", exact: true }).click();
  await page.getByRole("button", { name: "Customize tuning" }).click();

  const preset = page.getByRole("combobox", { name: "Transposition preset" });
  const defaultOption = page.getByRole("option", { name: "Trumpet in C", exact: true });
  const badgeInset = () =>
    defaultOption.getByText("Default", { exact: true }).evaluate((badge) => {
      const option = badge.closest('[role="option"]');
      if (!option) throw new Error("Select badge has no option");
      return option.getBoundingClientRect().right - badge.getBoundingClientRect().right;
    });

  await preset.click();
  await expect(defaultOption).toHaveAttribute("data-state", "checked");
  const selectedInset = await badgeInset();
  await page.getByRole("option", { name: "Trumpet in B♭", exact: true }).click();
  await preset.click();
  await expect(defaultOption).toHaveAttribute("data-state", "unchecked");
  expect(Math.abs(selectedInset - (await badgeInset()))).toBeLessThan(1);
});

test("keeps export actions visible while panel settings scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 500 });
  await openEditor(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();

  for (const format of ["PDF", "MP3"]) {
    if (format !== "PDF") {
      await page.getByRole("combobox", { name: "Export format" }).click();
      await page.getByRole("option", { name: format }).click();
    }
    const action = page.getByRole("button", { name: format === "PDF" ? /^Export \d+ layouts$/ : "Export MP3" });
    await expect(action).toBeInViewport();
    const before = await action.boundingBox();
    if (!before) throw new Error("Export action has no bounds");
    const scrolled = await page.getByRole("textbox", { name: "Filename pattern" }).evaluate((input) => {
      for (let parent = input.parentElement; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowY !== "auto") continue;
        parent.scrollTop = parent.scrollHeight - parent.clientHeight;
        return parent.scrollTop;
      }
      throw new Error("Export settings have no scrolling container");
    });
    expect(scrolled).toBeGreaterThan(0);
    await expect(action).toBeInViewport();
    const after = await action.boundingBox();
    if (!after) throw new Error("Export action has no bounds after scrolling");
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  }
});
