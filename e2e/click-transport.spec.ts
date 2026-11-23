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

for (const viewport of [
  { width: 1400, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`playback shrinks the transport and Stop restores it at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/click");
    await page
      .getByLabel("MNX file")
      .setInputFiles(
        resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
      );

    const panel = page.getByRole("region", { name: "Click player" });
    await panel.getByRole("option", { name: "Bar 3, rehearsal B" }).click();
    await panel.getByRole("radio", { name: "2 bars" }).click();
    const expanded = await panel.boundingBox();
    if (!expanded) throw new Error("Click transport is not visible");
    await panel.getByRole("button", { name: "Start", exact: true }).focus();
    await page.keyboard.press("Enter");

    const stop = panel.getByRole("button", { name: "Stop", exact: true });
    const bar = panel.getByRole("status", { name: "Current bar" });
    await expect(stop).toBeEnabled();
    await expect(bar).toHaveText("3");
    await expect(panel.getByRole("listbox")).toHaveCount(0);
    await expect(panel.getByRole("radiogroup")).toHaveCount(0);
    await expect(panel.getByRole("group", { name: "Selected start" })).toHaveCount(0);
    const compact = await panel.boundingBox();
    if (!compact) throw new Error("Compact click transport is not visible");
    expect(compact.width).toBeLessThan(expanded.width * 0.7);
    expect(compact.height).toBeLessThan(expanded.height * 0.6);

    const barBox = await bar.boundingBox();
    if (!barBox) throw new Error("Current bar is not visible");
    await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport.width - 10, viewport.height - 10, { steps: 5 });
    await page.mouse.up();
    await stop.click();

    const start = panel.getByRole("button", { name: "Start", exact: true });
    await expect(start).toBeEnabled();
    await expect(panel.getByRole("listbox", { name: "Rehearsal" })).toBeVisible();
    await expect(panel.getByRole("listbox", { name: "Start bar" })).toBeVisible();
    await expect(panel.getByRole("radio", { name: "2 bars" })).toBeChecked();
    await expect(panel.getByRole("group", { name: "Selected start" })).toContainText("B / Bar 3");
    await expect(bar).toHaveCount(0);
    await expect
      .poll(async () => {
        const restored = await panel.boundingBox();
        return (
          restored !== null &&
          Math.abs(restored.width - expanded.width) < 1 &&
          Math.abs(restored.height - expanded.height) < 1 &&
          restored.x >= 0 &&
          restored.y >= 0 &&
          restored.x + restored.width <= viewport.width &&
          restored.y + restored.height <= viewport.height
        );
      })
      .toBe(true);
  });
}
