import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("dragging the click transport does not select its text", async ({ page }) => {
  await page.goto("/click");
  await page
    .getByLabel("MNX file")
    .setInputFiles(resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"));

  const panel = page.getByRole("region", { name: "Click player" });
  const details = panel.getByRole("group", { name: "Selected start" });
  await expect(panel.getByRole("option", { name: "Bar 1, rehearsal A" })).toHaveAttribute("aria-selected", "true");
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
  await expect(panel.getByRole("option", { name: "Bar 3, rehearsal B" })).toHaveAttribute("aria-selected", "true");
});

test("dragging a navigation dial horizontally selects a later bar", async ({ page }) => {
  await page.goto("/click");
  await page
    .getByLabel("MNX file")
    .setInputFiles(resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"));

  const panel = page.getByRole("region", { name: "Click player" });
  await expect(panel.getByRole("option", { name: "Bar 1, rehearsal A" })).toHaveAttribute("aria-selected", "true");
  const box = await panel.getByRole("listbox", { name: "Start bar" }).boundingBox();
  if (!box) throw new Error("Start bar dial is not visible");

  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x + 80, y);
  await page.mouse.down();
  await page.mouse.move(x - 80, y, { steps: 8 });
  await page.waitForTimeout(150);
  await page.mouse.up();

  await expect(panel.getByRole("option", { name: "Bar 3, rehearsal B" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await expect(panel.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
});

for (const viewport of [
  { width: 1400, height: 900, barNumber: 3 },
  { width: 390, height: 844, barNumber: 137 },
]) {
  test(`playback shrinks the transport and Stop restores it at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/click");
    const fixture = await readFile(
      resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
      "utf8",
    );
    const score = JSON.parse(fixture) as { global: { measures: { number?: number }[] } };
    score.global.measures[2]!.number = viewport.barNumber;
    await page.getByLabel("MNX file").setInputFiles({
      name: "rehearsal-marks.mnx",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(score)),
    });

    const panel = page.getByRole("region", { name: "Click player" });
    const barName = `Bar ${viewport.barNumber}, rehearsal B`;
    await panel.getByRole("option", { name: barName }).click();
    await panel.getByRole("radio", { name: "2 bars" }).click();
    const zoom = page.getByLabel("Score zoom");
    await expect.poll(async () => Number.parseInt((await zoom.textContent()) ?? "0", 10)).toBeGreaterThan(100);
    const initialZoom = Number.parseInt((await zoom.textContent()) ?? "0", 10);
    const scoreView = page.getByRole("region", { name: "Score", exact: true });
    const initialScore = await scoreView.boundingBox();
    if (!initialScore) throw new Error("Score view is not visible");
    const expanded = await panel.boundingBox();
    if (!expanded) throw new Error("Click transport is not visible");
    const expandedButton = await panel.getByRole("button", { name: "Start", exact: true }).boundingBox();
    if (!expandedButton) throw new Error("Start button is not visible");
    await panel.getByRole("button", { name: "Start", exact: true }).focus();
    await page.keyboard.press("Enter");

    const stop = panel.getByRole("button", { name: "Stop", exact: true });
    const bar = panel.getByRole("status", { name: "Current bar" });
    await expect(stop).toBeEnabled();
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect
      .poll(async () => {
        const playingScore = await scoreView.boundingBox();
        return playingScore !== null && playingScore.y < 1 && Math.abs(playingScore.height - viewport.height) < 1;
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const playingZoom = Number.parseInt((await zoom.textContent()) ?? "0", 10);
        return Math.abs(playingZoom / initialZoom - viewport.height / initialScore.height);
      })
      .toBeLessThan(0.02);
    const compactButton = await stop.boundingBox();
    if (!compactButton) throw new Error("Stop button is not visible");
    expect(Math.abs(compactButton.x - expandedButton.x)).toBeLessThan(1);
    expect(Math.abs(compactButton.y - expandedButton.y)).toBeLessThan(1);
    expect(compactButton.width).toBeCloseTo(expandedButton.width, 0);
    expect(compactButton.height).toBeCloseTo(expandedButton.height, 0);
    await expect(bar).toHaveText(String(viewport.barNumber));
    await expect(panel.getByRole("listbox")).toHaveCount(0);
    await expect(panel.getByRole("radiogroup")).toHaveCount(0);
    await expect(panel.getByRole("group", { name: "Selected start" })).toHaveCount(0);
    const compact = await panel.boundingBox();
    if (!compact) throw new Error("Compact click transport is not visible");
    expect(compact.width).toBeLessThan(expanded.width * 0.7);
    expect(compact.height).toBeLessThan(expanded.height * 0.6);

    const barBox = await bar.boundingBox();
    if (!barBox) throw new Error("Current bar is not visible");
    const textWidth = await bar.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().width;
    });
    expect(barBox.width).toBeLessThanOrEqual(textWidth + 1);
    await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport.width - 10, viewport.height - 10, { steps: 5 });
    await page.mouse.up();
    const movedButton = await stop.boundingBox();
    if (!movedButton) throw new Error("Moved Stop button is not visible");
    await stop.click();

    const start = panel.getByRole("button", { name: "Start", exact: true });
    await expect(start).toBeEnabled();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect
      .poll(async () => {
        const restoredScore = await scoreView.boundingBox();
        return restoredScore === null ? Infinity : Math.abs(restoredScore.height - initialScore.height);
      })
      .toBeLessThan(1);
    await expect.poll(async () => Number.parseInt((await zoom.textContent()) ?? "0", 10)).toBe(initialZoom);
    await expect(panel.getByRole("listbox", { name: "Rehearsal" })).toBeVisible();
    await expect(panel.getByRole("listbox", { name: "Start bar" })).toBeVisible();
    await expect(panel.getByRole("radio", { name: "2 bars" })).toBeChecked();
    await expect(panel.getByRole("option", { name: barName })).toHaveAttribute("aria-selected", "true");
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
    const restoredButton = await start.boundingBox();
    if (!restoredButton) throw new Error("Restored Start button is not visible");
    expect(Math.abs(restoredButton.x - movedButton.x)).toBeLessThan(1);
    expect(Math.abs(restoredButton.y - movedButton.y)).toBeLessThan(1);
    await start.click();
    await expect(stop).toBeEnabled();
    const restartedButton = await stop.boundingBox();
    if (!restartedButton) throw new Error("Restarted Stop button is not visible");
    expect(Math.abs(restartedButton.x - restoredButton.x)).toBeLessThan(1);
    expect(Math.abs(restartedButton.y - restoredButton.y)).toBeLessThan(1);
    await stop.click();
  });
}

test.describe("compact transport touch movement", () => {
  test.use({ hasTouch: true });

  test("the narrower bar display still supports vertical dragging", async ({ page, context }) => {
    await page.goto("/click");
    await page
      .getByLabel("MNX file")
      .setInputFiles(
        resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
      );
    const panel = page.getByRole("region", { name: "Click player" });
    await panel.getByRole("button", { name: "Start", exact: true }).focus();
    await page.keyboard.press("Enter");
    const handle = panel.getByRole("status", { name: "Current bar" });
    await expect(handle).toBeVisible();
    const before = await panel.boundingBox();
    const area = await handle.boundingBox();
    if (!before || !area) throw new Error("Transport drag surface is not visible");
    const x = area.x + area.width / 2;
    const y = area.y + area.height / 2;
    const touch = await context.newCDPSession(page);
    try {
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 6; step++) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - step * 20 }],
        });
        await page.waitForTimeout(20);
      }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(async () => (await panel.boundingBox())?.y ?? Infinity).toBeLessThan(before.y - 100);
      await panel.getByRole("button", { name: "Stop", exact: true }).click();
    } finally {
      await touch.detach();
    }
  });
});
