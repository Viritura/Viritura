import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("dragging the click transport does not select its text", async ({ page }) => {
  await page.goto("/click");
  await page
    .getByLabel("MNX file")
    .setInputFiles(resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"));

  const panel = page.getByRole("region", { name: "Click player" });
  const details = panel.getByRole("group", { name: "Selected start" });
  await expect(details).toContainText("A / Bar 1");
  const initial = await panel.boundingBox();
  const area = await details.boundingBox();
  if (!initial || !area) throw new Error("Click transport is not visible");

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const y = area.y + area.height / 2;
  await page.mouse.move(area.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(area.x + Math.min(area.width - 2, 200), y, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => (await panel.boundingBox())?.x ?? 0).toBeGreaterThan(initial.x + 40);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");

  await panel.getByRole("radio", { name: "2 bars" }).click();
  await expect(panel.getByText("8 clicks free")).toBeVisible();
  await panel.getByRole("option", { name: "Bar 3, rehearsal B" }).click();
  await expect(details).toContainText("B / Bar 3");
});

test("dragging a navigation dial horizontally selects a later bar", async ({ page }) => {
  await page.goto("/click");
  await page
    .getByLabel("MNX file")
    .setInputFiles(resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"));

  const panel = page.getByRole("region", { name: "Click player" });
  const details = panel.getByRole("group", { name: "Selected start" });
  await expect(details).toContainText("A / Bar 1");
  const box = await panel.getByRole("listbox", { name: "Start bar" }).boundingBox();
  if (!box) throw new Error("Start bar dial is not visible");

  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x + 80, y);
  await page.mouse.down();
  await page.mouse.move(x - 80, y, { steps: 8 });
  await page.waitForTimeout(150);
  await page.mouse.up();

  await expect(details).toContainText("B / Bar 3");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await expect(panel.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
});
